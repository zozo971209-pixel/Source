/**
 * Supabase 認證橋接系統 v3.0
 * 攔截 React 的 localStorage 認證，並同步到 Supabase
 * 同時提供完整的用戶認證功能
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://grccrtpbshfycqicqtyn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_CO27p91THj9K7AZZblVpYg_FKqZRjov';
  const ADMIN_EMAIL = 'zozo971209@gmail.com';

  let supabase = null;
  let currentUser = null;
  let userProfile = null;
  let isInitialized = false;

  // ==================== 初始化 ====================
  function waitForSDK() {
    return new Promise(resolve => {
      let attempts = 0;
      const check = setInterval(() => {
        attempts++;
        if (window.supabaseClient) {
          clearInterval(check);
          resolve(window.supabaseClient);
        } else if (window.supabase && window.supabase.createClient) {
          clearInterval(check);
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
        } else if (attempts > 100) {
          clearInterval(check);
          console.error('[Auth] Supabase SDK 加載超時');
          resolve(null);
        }
      }, 50);
    });
  }

  async function init() {
    try {
      supabase = await waitForSDK();
      if (!supabase) return;

      // 監聽認證狀態變化
      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          currentUser = session.user;
          await syncUserProfile(currentUser);
          // 同步到 React 的 localStorage
          syncToReactAuth(userProfile);
        } else {
          currentUser = null;
          userProfile = null;
          // 清除 React 的 localStorage
          localStorage.removeItem('user');
        }
        updateUI();
        isInitialized = true;
      });

      // 檢查現有會話
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUser = session.user;
        await syncUserProfile(currentUser);
        syncToReactAuth(userProfile);
      }

      // 攔截 React 的登入/註冊
      interceptReactAuth();

      updateUI();
      isInitialized = true;

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

    // 更新 registered_users 以讓 React 的 login 函數能找到用戶
    const users = JSON.parse(localStorage.getItem('registered_users') || '[]');
    const idx = users.findIndex(u => u.email === profile.email);
    if (idx >= 0) {
      users[idx] = { ...users[idx], ...reactUser, password: users[idx].password };
    } else {
      users.push({ ...reactUser, password: '__supabase__' });
    }
    localStorage.setItem('registered_users', JSON.stringify(users));
  }

  // ==================== 攔截 React 認證 ====================
  function interceptReactAuth() {
    // 攔截 React 的登入對話框提交
    // 通過監聽 DOM 變化來攔截登入表單
    const observer = new MutationObserver((mutations) => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === 1) {
            // 查找登入按鈕
            const loginBtns = node.querySelectorAll ? node.querySelectorAll('button') : [];
            loginBtns.forEach(btn => {
              if (btn.textContent && (btn.textContent.includes('登入') || btn.textContent.includes('Login'))) {
                // 不攔截，讓 React 自己處理，但在之後同步到 Supabase
              }
            });
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ==================== 公開 API ====================

  // 登入
  window.loginUser = async (email, password) => {
    if (!supabase) {
      showToast('系統初始化中，請稍後再試', 'error');
      return false;
    }
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
      updateUI();
      showToast('登入成功！歡迎回來', 'success');
      // 觸發 React 重新渲染
      window.dispatchEvent(new Event('storage'));
      return true;
    } catch (err) {
      showToast('登入失敗，請稍後再試', 'error');
      return false;
    }
  };

  // 註冊
  window.registerUser = async (email, password, username, realName) => {
    if (!supabase) {
      showToast('系統初始化中，請稍後再試', 'error');
      return false;
    }
    if (!email || !password || !username) {
      showToast('請填寫完整資訊', 'error');
      return false;
    }
    if (password.length < 8) {
      showToast('密碼至少需要 8 個字符', 'error');
      return false;
    }

    try {
      // 先檢查 username 是否重複
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .single();
      if (existing) {
        showToast('此帳號名稱已被使用', 'error');
        return false;
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            name: realName || username,
            username: username
          }
        }
      });

      if (error) {
        if (error.message.includes('already registered')) {
          showToast('此信箱已被註冊', 'error');
        } else {
          showToast('註冊失敗：' + error.message, 'error');
        }
        return false;
      }

      if (data.user) {
        currentUser = data.user;
        // 手動創建用戶資料（因為 email 確認可能未啟用）
        const newProfile = {
          id: data.user.id,
          email: email,
          name: realName || username,
          username: username,
          role: 'user',
          is_admin: false,
          avatar: '',
          bio: ''
        };
        await supabase.from('users').upsert(newProfile);
        userProfile = newProfile;
        syncToReactAuth(userProfile);
        updateUI();
        showToast('註冊成功！歡迎加入源哲學網', 'success');
        window.dispatchEvent(new Event('storage'));
        return true;
      }
    } catch (err) {
      showToast('註冊失敗，請稍後再試', 'error');
      return false;
    }
  };

  // 登出
  window.logoutUser = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    currentUser = null;
    userProfile = null;
    localStorage.removeItem('user');
    localStorage.removeItem('registered_users');
    updateUI();
    showToast('已成功登出', 'success');
    window.dispatchEvent(new Event('storage'));
  };

  // 獲取當前用戶
  window.getCurrentUser = () => userProfile;
  window.isLoggedIn = () => !!currentUser;
  window.isAdmin = () => userProfile?.is_admin || userProfile?.email === ADMIN_EMAIL || false;

  // 更新用戶資料
  window.updateUserProfile = async (updates) => {
    if (!supabase || !currentUser) return false;
    try {
      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', currentUser.id);
      if (error) throw error;
      userProfile = { ...userProfile, ...updates };
      syncToReactAuth(userProfile);
      updateUI();
      return true;
    } catch (err) {
      showToast('更新失敗：' + err.message, 'error');
      return false;
    }
  };

  // 刪除帳號
  window.deleteAccount = async () => {
    if (!supabase || !currentUser) return false;
    if (!confirm('確定要刪除帳號嗎？此操作無法復原。')) return false;
    try {
      // 刪除用戶資料
      await supabase.from('users').delete().eq('id', currentUser.id);
      // 登出
      await supabase.auth.signOut();
      currentUser = null;
      userProfile = null;
      localStorage.removeItem('user');
      updateUI();
      showToast('帳號已刪除', 'success');
      setTimeout(() => window.location.href = '/', 1500);
      return true;
    } catch (err) {
      showToast('刪除失敗：' + err.message, 'error');
      return false;
    }
  };

  // ==================== UI 更新 ====================
  function updateUI() {
    const container = document.getElementById('auth-container');
    if (!container) return;

    container.innerHTML = '';

    if (currentUser && userProfile) {
      // 已登入
      const displayName = userProfile.name || userProfile.username || userProfile.email.split('@')[0];

      const userBtn = document.createElement('button');
      userBtn.onclick = () => window.location.href = './profile.html';
      userBtn.style.cssText = `
        padding: 8px 16px; background: rgba(212, 175, 55, 0.15);
        color: #d4af37; border: 1px solid rgba(212, 175, 55, 0.4);
        border-radius: 6px; cursor: pointer; font-size: 13px;
        transition: all 0.3s ease; font-weight: 500;
      `;
      userBtn.innerHTML = `👤 ${displayName}`;
      userBtn.onmouseover = () => { userBtn.style.background = 'rgba(212, 175, 55, 0.25)'; };
      userBtn.onmouseout = () => { userBtn.style.background = 'rgba(212, 175, 55, 0.15)'; };
      container.appendChild(userBtn);

      const logoutBtn = document.createElement('button');
      logoutBtn.onclick = window.logoutUser;
      logoutBtn.style.cssText = `
        padding: 8px 16px; background: transparent;
        color: #999; border: 1px solid #555;
        border-radius: 6px; cursor: pointer; font-size: 13px;
        transition: all 0.3s ease;
      `;
      logoutBtn.innerHTML = '登出';
      logoutBtn.onmouseover = () => { logoutBtn.style.color = '#fff'; logoutBtn.style.borderColor = '#999'; };
      logoutBtn.onmouseout = () => { logoutBtn.style.color = '#999'; logoutBtn.style.borderColor = '#555'; };
      container.appendChild(logoutBtn);
    } else {
      // 未登入
      const loginBtn = document.createElement('button');
      loginBtn.onclick = () => window.showLoginModal();
      loginBtn.style.cssText = `
        padding: 8px 16px; background: transparent;
        color: #d4af37; border: 1px solid rgba(212, 175, 55, 0.5);
        border-radius: 6px; cursor: pointer; font-size: 13px;
        transition: all 0.3s ease;
      `;
      loginBtn.innerHTML = '登入';
      loginBtn.onmouseover = () => { loginBtn.style.background = 'rgba(212, 175, 55, 0.1)'; };
      loginBtn.onmouseout = () => { loginBtn.style.background = 'transparent'; };
      container.appendChild(loginBtn);

      const regBtn = document.createElement('button');
      regBtn.onclick = () => window.showRegisterModal();
      regBtn.style.cssText = `
        padding: 8px 16px; background: rgba(212, 175, 55, 0.15);
        color: #d4af37; border: 1px solid rgba(212, 175, 55, 0.5);
        border-radius: 6px; cursor: pointer; font-size: 13px;
        transition: all 0.3s ease;
      `;
      regBtn.innerHTML = '註冊';
      regBtn.onmouseover = () => { regBtn.style.background = 'rgba(212, 175, 55, 0.25)'; };
      regBtn.onmouseout = () => { regBtn.style.background = 'rgba(212, 175, 55, 0.15)'; };
      container.appendChild(regBtn);
    }

    // 管理員按鈕
    const adminBtn = document.getElementById('admin-panel-btn');
    if (adminBtn) {
      adminBtn.style.display = window.isAdmin() ? 'block' : 'none';
    }
  }

  // ==================== 模態框 ====================
  window.showLoginModal = () => {
    document.getElementById('auth-modal-overlay')?.remove();
    const html = `
      <div id="auth-modal-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);display:flex;justify-content:center;align-items:center;z-index:99999;">
        <div style="background:#1a1a1a;border:1px solid rgba(212,175,55,0.3);padding:40px;border-radius:12px;width:90%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          <h2 style="color:#d4af37;margin:0 0 24px;font-size:22px;font-weight:600;">登入</h2>
          <input type="email" id="auth-email" placeholder="電子郵件" autocomplete="email"
            style="width:100%;padding:12px;margin:0 0 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <input type="password" id="auth-password" placeholder="密碼" autocomplete="current-password"
            style="width:100%;padding:12px;margin:0 0 8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <div id="auth-error" style="color:#ff6b6b;font-size:13px;min-height:20px;margin-bottom:12px;"></div>
          <button id="auth-login-btn" onclick="window._doLogin()"
            style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#a68c2f);color:#1a1a1a;border:none;border-radius:6px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:10px;">
            登入
          </button>
          <button onclick="document.getElementById('auth-modal-overlay').remove();window.showRegisterModal();"
            style="width:100%;padding:10px;background:transparent;color:#888;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:10px;">
            還沒有帳號？立即註冊
          </button>
          <button onclick="document.getElementById('auth-modal-overlay').remove()"
            style="width:100%;padding:10px;background:transparent;color:#666;border:none;cursor:pointer;font-size:13px;">
            取消
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('auth-email')?.focus();
    document.getElementById('auth-password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window._doLogin();
    });
  };

  window._doLogin = async () => {
    const email = document.getElementById('auth-email')?.value?.trim();
    const password = document.getElementById('auth-password')?.value;
    const errEl = document.getElementById('auth-error');
    const btn = document.getElementById('auth-login-btn');

    if (!email || !password) {
      if (errEl) errEl.textContent = '請填寫電子郵件和密碼';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '登入中...'; }
    if (errEl) errEl.textContent = '';

    const ok = await window.loginUser(email, password);
    if (ok) {
      document.getElementById('auth-modal-overlay')?.remove();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '登入'; }
      if (errEl) errEl.textContent = '信箱或密碼錯誤，請重新輸入';
    }
  };

  window.showRegisterModal = () => {
    document.getElementById('auth-modal-overlay')?.remove();
    const html = `
      <div id="auth-modal-overlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);display:flex;justify-content:center;align-items:center;z-index:99999;">
        <div style="background:#1a1a1a;border:1px solid rgba(212,175,55,0.3);padding:40px;border-radius:12px;width:90%;max-width:420px;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
          <h2 style="color:#d4af37;margin:0 0 24px;font-size:22px;font-weight:600;">註冊帳號</h2>
          <input type="email" id="reg-email" placeholder="電子郵件" autocomplete="email"
            style="width:100%;padding:12px;margin:0 0 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <input type="text" id="reg-username" placeholder="帳號名稱（不可重複）" autocomplete="username"
            style="width:100%;padding:12px;margin:0 0 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <input type="text" id="reg-realname" placeholder="顯示名稱"
            style="width:100%;padding:12px;margin:0 0 12px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <input type="password" id="reg-password" placeholder="密碼（至少 8 個字符）" autocomplete="new-password"
            style="width:100%;padding:12px;margin:0 0 8px;background:#2a2a2a;border:1px solid #444;border-radius:6px;color:#fff;font-size:14px;box-sizing:border-box;outline:none;">
          <div id="reg-error" style="color:#ff6b6b;font-size:13px;min-height:20px;margin-bottom:12px;"></div>
          <button id="reg-submit-btn" onclick="window._doRegister()"
            style="width:100%;padding:12px;background:linear-gradient(135deg,#d4af37,#a68c2f);color:#1a1a1a;border:none;border-radius:6px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:10px;">
            註冊
          </button>
          <button onclick="document.getElementById('auth-modal-overlay').remove();window.showLoginModal();"
            style="width:100%;padding:10px;background:transparent;color:#888;border:1px solid #444;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:10px;">
            已有帳號？立即登入
          </button>
          <button onclick="document.getElementById('auth-modal-overlay').remove()"
            style="width:100%;padding:10px;background:transparent;color:#666;border:none;cursor:pointer;font-size:13px;">
            取消
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById('reg-email')?.focus();
  };

  window._doRegister = async () => {
    const email = document.getElementById('reg-email')?.value?.trim();
    const username = document.getElementById('reg-username')?.value?.trim();
    const realName = document.getElementById('reg-realname')?.value?.trim();
    const password = document.getElementById('reg-password')?.value;
    const errEl = document.getElementById('reg-error');
    const btn = document.getElementById('reg-submit-btn');

    if (!email || !username || !password) {
      if (errEl) errEl.textContent = '請填寫所有必填欄位';
      return;
    }
    if (password.length < 8) {
      if (errEl) errEl.textContent = '密碼至少需要 8 個字符';
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = '註冊中...'; }
    if (errEl) errEl.textContent = '';

    const ok = await window.registerUser(email, password, username, realName);
    if (ok) {
      document.getElementById('auth-modal-overlay')?.remove();
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '註冊'; }
    }
  };

  // ==================== Toast 通知 ====================
  function showToast(message, type = 'info') {
    const existing = document.getElementById('auth-toast');
    if (existing) existing.remove();

    const colors = {
      success: { bg: '#1a3a1a', border: '#4caf50', text: '#4caf50' },
      error: { bg: '#3a1a1a', border: '#f44336', text: '#f44336' },
      info: { bg: '#1a2a3a', border: '#2196f3', text: '#2196f3' }
    };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.id = 'auth-toast';
    toast.style.cssText = `
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
      background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
      padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 500;
      z-index: 999999; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      animation: slideUp 0.3s ease;
      max-width: 90vw; text-align: center;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ==================== 互動系統（按讚/收藏）====================
  window.toggleContentLike = async (contentType, contentId) => {
    if (!supabase || !currentUser) {
      window.showLoginModal();
      return false;
    }
    try {
      const { data: existing } = await supabase
        .from('content_likes')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('content_type', contentType)
        .eq('content_id', contentId)
        .single();

      if (existing) {
        await supabase.from('content_likes').delete()
          .eq('user_id', currentUser.id)
          .eq('content_type', contentType)
          .eq('content_id', contentId);
        return false; // unliked
      } else {
        await supabase.from('content_likes').insert({
          user_id: currentUser.id,
          content_type: contentType,
          content_id: contentId
        });
        return true; // liked
      }
    } catch (err) {
      console.warn('[Auth] 按讚失敗:', err);
      return null;
    }
  };

  window.toggleContentBookmark = async (contentType, contentId) => {
    if (!supabase || !currentUser) {
      window.showLoginModal();
      return false;
    }
    try {
      const { data: existing } = await supabase
        .from('content_bookmarks')
        .select('id')
        .eq('user_id', currentUser.id)
        .eq('content_type', contentType)
        .eq('content_id', contentId)
        .single();

      if (existing) {
        await supabase.from('content_bookmarks').delete()
          .eq('user_id', currentUser.id)
          .eq('content_type', contentType)
          .eq('content_id', contentId);
        return false;
      } else {
        await supabase.from('content_bookmarks').insert({
          user_id: currentUser.id,
          content_type: contentType,
          content_id: contentId
        });
        return true;
      }
    } catch (err) {
      console.warn('[Auth] 收藏失敗:', err);
      return null;
    }
  };

  window.checkContentLike = async (contentType, contentId) => {
    if (!supabase || !currentUser) return false;
    const { data } = await supabase
      .from('content_likes')
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .single();
    return !!data;
  };

  window.checkContentBookmark = async (contentType, contentId) => {
    if (!supabase || !currentUser) return false;
    const { data } = await supabase
      .from('content_bookmarks')
      .select('id')
      .eq('user_id', currentUser.id)
      .eq('content_type', contentType)
      .eq('content_id', contentId)
      .single();
    return !!data;
  };

  // 提交意見回報
  window.submitReport = async (type, content, contactEmail) => {
    if (!supabase) return false;
    try {
      const { error } = await supabase.from('reports').insert({
        user_id: currentUser?.id || null,
        type: type,
        content: content,
        contact_email: contactEmail || currentUser?.email || null,
        status: 'pending'
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Auth] 提交回報失敗:', err);
      return false;
    }
  };

  // 提交投稿
  window.submitContribution = async (data) => {
    if (!supabase || !currentUser) {
      window.showLoginModal();
      return false;
    }
    try {
      const { error } = await supabase.from('submissions').insert({
        user_id: currentUser.id,
        ...data,
        status: 'pending'
      });
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('[Auth] 提交投稿失敗:', err);
      return false;
    }
  };

  // 獲取 Supabase 客戶端（供其他腳本使用）
  window.getSupabaseClient = () => supabase;

  // ==================== 啟動 ====================
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from { opacity: 0; transform: translateX(-50%) translateY(20px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
  `;
  document.head.appendChild(style);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }
})();

/**
 * ==================== 動態資料橋接層 v1.0 ====================
 * 讓前台 React 應用能讀取 Supabase 中管理員新增的內容
 * 透過覆蓋 React 的資料讀取邏輯，注入 Supabase 資料
 */
(function dynamicDataBridge() {
  'use strict';

  // 等待 Supabase 客戶端就緒
  function waitForSupabase(cb) {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (window.supabaseClient) { clearInterval(t); cb(window.supabaseClient); }
      else if (n > 100) clearInterval(t);
    }, 100);
  }

  // 將 Supabase 資料注入到全域，供 React 讀取
  async function injectSupabaseData(sb) {
    try {
      // 讀取所有哲學家（含地區和時代資訊）
      const { data: philosophers } = await sb
        .from('philosophers')
        .select(`
          id, name, name_en, birth_year, death_year, bio, avatar, era_id,
          eras(id, name, region_id, regions(id, name))
        `)
        .order('birth_year', { ascending: true });

      // 讀取所有理論
      const { data: theories } = await sb
        .from('theories')
        .select(`
          id, name, name_en, description, philosopher_id,
          philosophers(id, name)
        `)
        .order('created_at', { ascending: true });

      // 讀取所有論證
      const { data: arguments_ } = await sb
        .from('arguments')
        .select(`
          id, title, content, philosopher_id, theory_id, question_id,
          philosophers(id, name),
          theories(id, name)
        `)
        .order('created_at', { ascending: true });

      // 讀取所有問題
      const { data: questions } = await sb
        .from('questions')
        .select('id, title, description, category')
        .order('created_at', { ascending: true });

      // 讀取所有地區
      const { data: regions } = await sb
        .from('regions')
        .select('id, name, description')
        .order('name');

      // 讀取所有時代
      const { data: eras } = await sb
        .from('eras')
        .select('id, name, start_year, end_year, region_id, regions(name)')
        .order('start_year', { ascending: true });

      // 將資料存入全域，供 React 和其他腳本使用
      window.__supabaseData = {
        philosophers: philosophers || [],
        theories: theories || [],
        arguments: arguments_ || [],
        questions: questions || [],
        regions: regions || [],
        eras: eras || [],
        loadedAt: new Date().toISOString()
      };

      // 觸發自訂事件，通知 React 資料已就緒
      window.dispatchEvent(new CustomEvent('supabaseDataLoaded', {
        detail: window.__supabaseData
      }));

      // 嘗試注入到 React 的 localStorage（讓 React 能讀取）
      injectToReactStorage(window.__supabaseData);

    } catch (err) {
      console.warn('[DataBridge] 載入資料失敗:', err);
    }
  }

  function injectToReactStorage(data) {
    try {
      // 將哲學家資料格式化為 React 期望的格式
      if (data.philosophers && data.philosophers.length > 0) {
        const reactPhilosophers = data.philosophers.map(p => ({
          id: p.id,
          name: p.name,
          nameEn: p.name_en || '',
          birthYear: p.birth_year,
          deathYear: p.death_year,
          bio: p.bio || '',
          avatar: p.avatar || '',
          era: p.eras?.name || '',
          region: p.eras?.regions?.name || '',
          eraId: p.era_id
        }));
        localStorage.setItem('supabase_philosophers', JSON.stringify(reactPhilosophers));
      }

      // 將理論資料格式化
      if (data.theories && data.theories.length > 0) {
        const reactTheories = data.theories.map(t => ({
          id: t.id,
          name: t.name,
          nameEn: t.name_en || '',
          description: t.description || '',
          philosopherId: t.philosopher_id,
          philosopherName: t.philosophers?.name || ''
        }));
        localStorage.setItem('supabase_theories', JSON.stringify(reactTheories));
      }

      // 將論證資料格式化
      if (data.arguments && data.arguments.length > 0) {
        const reactArguments = data.arguments.map(a => ({
          id: a.id,
          title: a.title,
          content: a.content || '',
          philosopherId: a.philosopher_id,
          theoryId: a.theory_id,
          questionId: a.question_id,
          philosopherName: a.philosophers?.name || '',
          theoryName: a.theories?.name || ''
        }));
        localStorage.setItem('supabase_arguments', JSON.stringify(reactArguments));
      }

      // 觸發 storage 事件讓 React 重新讀取
      window.dispatchEvent(new Event('storage'));
    } catch (err) {
      console.warn('[DataBridge] 注入 localStorage 失敗:', err);
    }
  }

  // 提供全域 API 供外部調用
  window.refreshSupabaseData = () => {
    waitForSupabase(injectSupabaseData);
  };

  // 頁面載入時自動執行
  waitForSupabase(sb => {
    // 延遲 1 秒確保 React 已渲染
    setTimeout(() => injectSupabaseData(sb), 1000);
    // 每 5 分鐘自動刷新一次
    setInterval(() => injectSupabaseData(sb), 5 * 60 * 1000);
  });
})();
