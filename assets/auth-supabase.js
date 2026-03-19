/**
 * Supabase 認證橋接系統 v4.0
 * 
 * 策略：讓 React 的原生 Navbar UI 正常工作
 * - 不建立外部按鈕（避免與 React Navbar 重疊）
 * - 只負責 Supabase ↔ React localStorage 的認證狀態同步
 * - React 的登入/登出/個人資料按鈕由 React 自己管理
 * - 攔截 React 的認證操作，同步到 Supabase
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://grccrtpbshfycqicqtyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_CO27p91THj9K7AZZblVpYg_FKqZRjov';
  const ADMIN_EMAIL = 'zozo971209@gmail.com';

  let supabase = null;
  let currentUser = null;
  let userProfile = null;

  // ==================== 初始化 ====================
  async function waitForSDK() {
    return new Promise(resolve => {
      let n = 0;
      const t = setInterval(() => {
        n++;
        if (window.supabaseClient) { clearInterval(t); resolve(window.supabaseClient); return; }
        if (window.supabase && window.supabase.createClient) {
          clearInterval(t);
          const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storageKey: 'sb-grccrtpbshfycqicqtyn-auth-token'
            }
          });
          window.supabaseClient = client;
          resolve(client);
          return;
        }
        if (n > 100) { clearInterval(t); resolve(null); }
      }, 50);
    });
  }

  async function init() {
    try {
      supabase = await waitForSDK();
      if (!supabase) { console.error('[Auth] Supabase SDK 加載失敗'); return; }

      // 監聽認證狀態變化
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          currentUser = session.user;
          await syncUserProfile(currentUser);
          syncToReactAuth(userProfile);
          // 通知 React 重新渲染
          window.dispatchEvent(new Event('storage'));
        } else {
          currentUser = null;
          userProfile = null;
          localStorage.removeItem('user');
          window.dispatchEvent(new Event('storage'));
        }
      });

      // 檢查現有會話
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUser = session.user;
        await syncUserProfile(currentUser);
        syncToReactAuth(userProfile);
        window.dispatchEvent(new Event('storage'));
      }

      // 攔截 React 的登入/登出操作
      interceptReactLoginLogout();

    } catch (err) {
      console.error('[Auth] 初始化失敗:', err);
    }
  }

  // ==================== 用戶資料同步 ====================
  async function syncUserProfile(user) {
    if (!user || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // 用戶不存在，創建
        const newProfile = {
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email.split('@')[0],
          username: user.user_metadata?.username || user.email.split('@')[0],
          role: user.email === ADMIN_EMAIL ? 'admin' : 'user',
          is_admin: user.email === ADMIN_EMAIL,
          avatar: user.user_metadata?.avatar_url || '',
          bio: ''
        };
        const { data: created } = await supabase
          .from('users')
          .insert(newProfile)
          .select()
          .single();
        userProfile = created || newProfile;
      } else if (data) {
        userProfile = data;
        // 確保管理員狀態正確
        if (user.email === ADMIN_EMAIL && (!data.is_admin || data.role !== 'admin')) {
          await supabase.from('users').update({ role: 'admin', is_admin: true }).eq('id', user.id);
          userProfile.role = 'admin';
          userProfile.is_admin = true;
        }
      }
    } catch (err) {
      console.warn('[Auth] 同步用戶資料失敗:', err);
    }
  }

  // 同步到 React 的 localStorage（讓 React 的 useAuth hook 能讀取）
  function syncToReactAuth(profile) {
    if (!profile) return;
    const reactUser = {
      id: profile.id,
      username: profile.name || profile.username || profile.email.split('@')[0],
      email: profile.email,
      avatar: profile.avatar || '',
      bio: profile.bio || '',
      createdAt: profile.created_at || new Date().toISOString(),
      isVerified: true,
      isAdmin: profile.is_admin || profile.email === ADMIN_EMAIL
    };
    localStorage.setItem('user', JSON.stringify(reactUser));
    // 更新 registered_users 讓 React 的 login 函數能找到用戶
    try {
      const users = JSON.parse(localStorage.getItem('registered_users') || '[]');
      const idx = users.findIndex(u => u.email === profile.email);
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...reactUser, password: users[idx].password };
      } else {
        users.push({ ...reactUser, password: '__supabase__' });
      }
      localStorage.setItem('registered_users', JSON.stringify(users));
    } catch(e) {}
  }

  // ==================== 攔截 React 認證操作 ====================
  function interceptReactLoginLogout() {
    // 攔截 localStorage.setItem，同步按讚/收藏狀態
    const origSetItem = localStorage.setItem.bind(localStorage);
    let _syncingLikes = false;
    localStorage.setItem = function(key, value) {
      origSetItem(key, value);
      if (_syncingLikes) return;
      _syncingLikes = true;
      try {
        // 同步 likes ↔ likedTheories
        if (key === 'likes') {
          const ids = JSON.parse(value) || [];
          origSetItem('likedTheories', JSON.stringify(ids));
          // 更新 philosophy_philosophers 中 theory 的 likes 計數
          updateTheoryLikeCounts(ids, null);
        } else if (key === 'likedTheories') {
          const ids = JSON.parse(value) || [];
          origSetItem('likes', JSON.stringify(ids));
          updateTheoryLikeCounts(ids, null);
        }
        // 同步 bookmarks ↔ bookmarkedTheories
        if (key === 'bookmarks') {
          const ids = JSON.parse(value) || [];
          origSetItem('bookmarkedTheories', JSON.stringify(ids));
          updateTheoryLikeCounts(null, ids);
        } else if (key === 'bookmarkedTheories') {
          const ids = JSON.parse(value) || [];
          origSetItem('bookmarks', JSON.stringify(ids));
          updateTheoryLikeCounts(null, ids);
        }
      } catch(e) {}
      _syncingLikes = false;
    };

    // 攔截 localStorage.removeItem，同步 React 的登出到 Supabase
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function(key) {
      origRemoveItem(key);
      if (key === 'user' && currentUser && supabase) {
        supabase.auth.signOut().catch(() => {});
        currentUser = null;
        userProfile = null;
      }
    };
  }

  // ==================== 更新 theory 的 likes/bookmarks 計數 ====================
  // 注意：React 的 getLikeCount(baseCount, id) = baseCount + (isLiked ? 1 : 0)
  // 所以 theory.likes 應該保持為 0（代表「其他人」的按讚數），不要設為 1
  // 否則會顯示 1+1=2 的重複計數
  // 此函數只做雙向同步，不修改 theory.likes
  function updateTheoryLikeCounts(likedIds, bookmarkedIds) {
    // 不修改 philosophy_philosophers 中的 likes/bookmarks 數字
    // React 的 getLikeCount 會自動加上當前用戶的按讚
  }

  // ==================== 從 Supabase 同步後台內容到前台 ====================
  async function syncSupabaseDataToReact() {
    if (!supabase) return;
    try {
      // 1. 同步 regions
      const { data: regions } = await supabase.from('regions').select('*').order('created_at');
      if (regions && regions.length > 0) {
        // 讀取現有的 React regions 資料（保留原有格式）
        const existingRegions = JSON.parse(localStorage.getItem('philosophy_regions') || 'null');
        const baseRegions = existingRegions || [
          {id:'western',name:'西方哲學',nameEn:'Western Philosophy',description:'從古希臘的理性之光到當代的語言轉向，探索西方思想的演變歷程。'},
          {id:'eastern',name:'東方哲學',nameEn:'Eastern Philosophy',description:'儒釋道三家並立，探索中國哲學的深邃智慧與人生境界。'},
          {id:'indian',name:'印度哲學',nameEn:'Indian Philosophy',description:'梵我合一的終極追求，六派正統哲學與佛教思想的深奧體系。'},
          {id:'islamic',name:'伊斯蘭哲學',nameEn:'Islamic Philosophy',description:'理性與啟示的交匯，阿拉伯哲學的黃金時代與獨特傳統。'}
        ];
        // 加入 Supabase 中有但 React 中沒有的地區
        const existingNames = baseRegions.map(r => r.name);
        regions.forEach(r => {
          if (!existingNames.includes(r.name)) {
            baseRegions.push({
              id: r.id,
              name: r.name,
              nameEn: r.name,
              description: r.description || ''
            });
          }
        });
        localStorage.setItem('philosophy_regions', JSON.stringify(baseRegions));
      }

      // 2. 同步 eras（時代）
      const { data: eras } = await supabase.from('eras').select('*, regions(name)').order('created_at');
      if (eras && eras.length > 0) {
        const existingEras = JSON.parse(localStorage.getItem('philosophy_eras') || 'null');
        const baseEras = existingEras || [];
        const existingNames = baseEras.map(e => e.title);
        eras.forEach(era => {
          if (!existingNames.includes(era.name)) {
            baseEras.push({
              id: era.id,
              period: era.period || '',
              title: era.name,
              titleEn: era.name,
              description: era.description || '',
              features: era.features || [],
              philosopherCount: era.philosopher_count || 0,
              region: era.region_id,
              regionName: era.regions?.name || ''
            });
          }
        });
        localStorage.setItem('philosophy_eras', JSON.stringify(baseEras));
      }

      // 3. 同步 philosophers
      const { data: philosophers } = await supabase.from('philosophers').select('*, eras(name, region_id), regions(name)').order('created_at');
      if (philosophers && philosophers.length > 0) {
        const existingPhils = JSON.parse(localStorage.getItem('philosophy_philosophers') || 'null');
        const basePhils = existingPhils || [];
        const existingNames = basePhils.map(p => p.name);
        philosophers.forEach(phil => {
          if (!existingNames.includes(phil.name)) {
            basePhils.push({
              id: phil.id,
              name: phil.name,
              nameEn: phil.name,
              birthYear: phil.birth_year || '',
              deathYear: phil.death_year || '',
              birthplace: '',
              era: phil.era_id,
              eraName: phil.eras?.name || '',
              region: phil.region_id,
              regionName: phil.regions?.name || '',
              biography: phil.biography || '',
              theories: [],
              works: phil.works || []
            });
          }
        });
        localStorage.setItem('philosophy_philosophers', JSON.stringify(basePhils));
      }

      // 4. 同步 questions（哲學問題）
      const { data: questions } = await supabase.from('questions').select('*').order('created_at');
      if (questions && questions.length > 0) {
        const existingQs = JSON.parse(localStorage.getItem('philosophy_questions') || 'null');
        const baseQs = existingQs || [];
        const existingTitles = baseQs.map(q => q.title);
        questions.forEach(q => {
          if (!existingTitles.includes(q.title)) {
            baseQs.push({
              id: q.id,
              title: q.title,
              description: q.description || '',
              category: q.category || '',
              difficulty: q.difficulty || 'medium',
              philosophers: [],
              arguments: []
            });
          }
        });
        localStorage.setItem('philosophy_questions', JSON.stringify(baseQs));
      }

      console.log('[DataSync] Supabase 資料已同步到 React localStorage');
    } catch(err) {
      console.warn('[DataSync] 同步失敗:', err);
    }
  }

  // ==================== 公開 API ====================
  // 登入（供 React 的登入對話框調用）
  window.loginUser = async (email, password) => {
    if (!supabase) { showToast('系統初始化中，請稍後再試', 'error'); return false; }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          showToast('信箱或密碼錯誤', 'error');
        } else if (error.message.includes('Email not confirmed')) {
          showToast('請先驗證您的信箱', 'error');
        } else {
          showToast('登入失敗：' + error.message, 'error');
        }
        return false;
      }
      currentUser = data.user;
      await syncUserProfile(currentUser);
      syncToReactAuth(userProfile);
      window.dispatchEvent(new Event('storage'));
      showToast('登入成功！歡迎回來', 'success');
      return true;
    } catch (err) {
      showToast('登入失敗，請稍後再試', 'error');
      return false;
    }
  };

  // 註冊
  window.registerUser = async (email, password, username) => {
    if (!supabase) { showToast('系統初始化中，請稍後再試', 'error'); return false; }
    if (!email || !password || !username) { showToast('請填寫完整資訊', 'error'); return false; }
    try {
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { username, name: username } }
      });
      if (error) { showToast('註冊失敗：' + error.message, 'error'); return false; }
      if (data.user) {
        currentUser = data.user;
        await syncUserProfile(currentUser);
        syncToReactAuth(userProfile);
        window.dispatchEvent(new Event('storage'));
        showToast('註冊成功！', 'success');
        return true;
      }
      return false;
    } catch (err) {
      showToast('註冊失敗，請稍後再試', 'error');
      return false;
    }
  };

  // 登出
  window.logoutUser = async () => {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    userProfile = null;
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('storage'));
    showToast('已登出', 'success');
    setTimeout(() => window.location.href = './', 500);
  };

  // 檢查是否為管理員
  window.isAdmin = () => {
    if (currentUser && currentUser.email === ADMIN_EMAIL) return true;
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return u.isAdmin || u.email === ADMIN_EMAIL;
    } catch(e) { return false; }
  };

  // 獲取當前用戶
  window.getCurrentUser = () => currentUser;
  window.getUserProfile = () => userProfile;

  // ==================== 登入/註冊模態框 ====================
  // 攔截 React 的登入按鈕，顯示 Supabase 登入對話框
  window.showLoginModal = () => {
    document.getElementById('auth-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid rgba(212,175,55,0.3);border-radius:16px;padding:32px;width:100%;max-width:400px;position:relative;">
        <button onclick="document.getElementById('auth-modal-overlay').remove()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
        <h2 style="color:#d4af37;font-size:20px;margin-bottom:24px;text-align:center;">登入</h2>
        <div id="auth-error" style="display:none;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;"></div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">電子信箱</label>
          <input id="auth-email" type="email" placeholder="your@email.com" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">密碼</label>
          <input id="auth-password" type="password" placeholder="••••••••" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <button onclick="doLogin()" style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#a68c2f);color:#1a1a1a;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:12px;">登入</button>
        <p style="text-align:center;color:#888;font-size:13px;">還沒有帳號？<a href="#" onclick="window.showRegisterModal();return false;" style="color:#d4af37;text-decoration:none;">立即註冊</a></p>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => document.getElementById('auth-email')?.focus(), 100);

    window.doLogin = async () => {
      const email = document.getElementById('auth-email')?.value?.trim();
      const password = document.getElementById('auth-password')?.value;
      const errEl = document.getElementById('auth-error');
      if (!email || !password) { errEl.textContent = '請填寫信箱和密碼'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';
      const ok = await window.loginUser(email, password);
      if (ok) document.getElementById('auth-modal-overlay')?.remove();
      else { errEl.textContent = '登入失敗，請檢查信箱和密碼'; errEl.style.display = 'block'; }
    };

    // Enter 鍵提交
    overlay.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.doLogin(); });
    });
  };

  window.showRegisterModal = () => {
    document.getElementById('auth-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid rgba(212,175,55,0.3);border-radius:16px;padding:32px;width:100%;max-width:400px;position:relative;">
        <button onclick="document.getElementById('auth-modal-overlay').remove()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
        <h2 style="color:#d4af37;font-size:20px;margin-bottom:24px;text-align:center;">註冊</h2>
        <div id="reg-error" style="display:none;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;"></div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">用戶名稱</label>
          <input id="reg-username" type="text" placeholder="您的名稱" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">電子信箱</label>
          <input id="reg-email" type="email" placeholder="your@email.com" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">密碼（至少 6 位）</label>
          <input id="reg-password" type="password" placeholder="••••••••" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <button onclick="doRegister()" style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#a68c2f);color:#1a1a1a;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:12px;">註冊</button>
        <p style="text-align:center;color:#888;font-size:13px;">已有帳號？<a href="#" onclick="window.showLoginModal();return false;" style="color:#d4af37;text-decoration:none;">立即登入</a></p>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    window.doRegister = async () => {
      const username = document.getElementById('reg-username')?.value?.trim();
      const email = document.getElementById('reg-email')?.value?.trim();
      const password = document.getElementById('reg-password')?.value;
      const errEl = document.getElementById('reg-error');
      if (!username || !email || !password) { errEl.textContent = '請填寫完整資訊'; errEl.style.display = 'block'; return; }
      if (password.length < 6) { errEl.textContent = '密碼至少需要 6 位'; errEl.style.display = 'block'; return; }
      errEl.style.display = 'none';
      const ok = await window.registerUser(email, password, username);
      if (ok) document.getElementById('auth-modal-overlay')?.remove();
      else { errEl.textContent = '註冊失敗，請稍後再試'; errEl.style.display = 'block'; }
    };
  };

  // ==================== Toast 通知 ====================
  function showToast(msg, type) {
    const existing = document.getElementById('auth-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'auth-toast';
    const colors = { success: { bg: '#1a3a1a', border: '#4caf50', text: '#4caf50' }, error: { bg: '#3a1a1a', border: '#f44336', text: '#f44336' } };
    const c = colors[type] || { bg: '#1a2a3a', border: '#2196f3', text: '#2196f3' };
    toast.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-size:14px;z-index:99998;background:${c.bg};border:1px solid ${c.border};color:${c.text};white-space:nowrap;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ==================== 攔截 React Navbar 的登入/登出按鈕 ====================
  // React Navbar 有自己的登入按鈕，點擊後會呼叫 onLoginClick prop
  // 我們需要攔截這個按鈕，讓它顯示我們的 Supabase 登入對話框
  function interceptNavbarButtons() {
    function tryIntercept() {
      const navbar = document.querySelector('header[role="banner"]');
      if (!navbar) return false;

      // 攔截「登入」按鈕
      navbar.querySelectorAll('button').forEach(btn => {
        const txt = (btn.textContent || '').trim();
        if (txt === '登入' && !btn.dataset.intercepted) {
          btn.dataset.intercepted = '1';
          btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.showLoginModal();
          }, true);
        }
        // 攔截「管理員」按鈕 → 跳轉到 admin/index.html
        if ((txt === '管理員' || txt.includes('管理員')) && !btn.dataset.intercepted) {
          btn.dataset.intercepted = '1';
          btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = './admin/index.html';
          }, true);
        }
      });

      // 攔截「個人資料」連結 → 跳轉到 profile.html
      navbar.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const txt = (a.textContent || '').trim();
        if ((href.includes('/profile') || txt === '個人資料') && !a.dataset.intercepted) {
          a.dataset.intercepted = '1';
          a.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = './profile.html';
          }, true);
        }
        // 攔截「管理員」連結
        if (href.includes('/admin') && !a.dataset.intercepted) {
          a.dataset.intercepted = '1';
          a.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = './admin/index.html';
          }, true);
        }
      });

      // 攔截「登出」選單項目
      document.querySelectorAll('[role="menuitem"]').forEach(item => {
        const txt = (item.textContent || '').trim();
        if ((txt === '登出' || txt === 'Logout') && !item.dataset.intercepted) {
          item.dataset.intercepted = '1';
          item.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.logoutUser();
          }, true);
        }
      });

      return true;
    }

    // 持續監控 DOM 變化，確保攔截所有新渲染的按鈕
    const obs = new MutationObserver(() => setTimeout(tryIntercept, 100));
    function start() {
      obs.observe(document.body, { childList: true, subtree: true });
      [200, 500, 1000, 2000].forEach(t => setTimeout(tryIntercept, t));
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ==================== 初始化按讚/收藏同步 ====================
  function initLikesSync() {
    // 確保 likes 和 likedTheories 初始狀態一致
    try {
      const likes = JSON.parse(localStorage.getItem('likes') || '[]');
      const likedTheories = JSON.parse(localStorage.getItem('likedTheories') || '[]');
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
      const bookmarkedTheories = JSON.parse(localStorage.getItem('bookmarkedTheories') || '[]');
      // 合併兩個陣列（取聯集）
      const mergedLikes = [...new Set([...likes, ...likedTheories])];
      const mergedBookmarks = [...new Set([...bookmarks, ...bookmarkedTheories])];
      const orig = localStorage.setItem.bind(localStorage);
      orig('likes', JSON.stringify(mergedLikes));
      orig('likedTheories', JSON.stringify(mergedLikes));
      orig('bookmarks', JSON.stringify(mergedBookmarks));
      orig('bookmarkedTheories', JSON.stringify(mergedBookmarks));
      // 更新 theory 的 likes/bookmarks 計數
      updateTheoryLikeCounts(mergedLikes, mergedBookmarks);
    } catch(e) {}
  }

  // ==================== 啟動 ====================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init();
      interceptNavbarButtons();
      initLikesSync();
      // 頁面載入後從 Supabase 同步資料
      setTimeout(async () => {
        await waitForSDK();
        if (supabase) await syncSupabaseDataToReact();
      }, 1000);
    });
  } else {
    init();
    interceptNavbarButtons();
    initLikesSync();
    // 頁面載入後從 Supabase 同步資料
    setTimeout(async () => {
      await waitForSDK();
      if (supabase) await syncSupabaseDataToReact();
    }, 1000);
  }

})();
