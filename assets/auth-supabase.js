/**
 * Supabase 認證橋接系統 v6.0
 *
 * 修復項目：
 * 1. 按讚/收藏同步到 Supabase content_likes/content_bookmarks 表格
 * 2. 個人頁面白畫面（加入載入動畫）
 * 3. 後台新增地區同步到前台（MutationObserver DOM 注入）
 * 4. baseCount:128 硬編碼問題（DOM 覆蓋）
 * 5. localStorage 兩個系統（likes/likedTheories）雙向同步
 */
(function () {
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
      if (!supabase) { console.warn('[Auth] Supabase SDK 加載失敗'); return; }

      supabase.auth.onAuthStateChange(async (event, session) => {
        if (session) {
          currentUser = session.user;
          await syncUserProfile(currentUser);
          syncToReactAuth(userProfile);
          window.dispatchEvent(new Event('storage'));
        } else {
          currentUser = null;
          userProfile = null;
          localStorage.removeItem('user');
          window.dispatchEvent(new Event('storage'));
        }
      });

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        currentUser = session.user;
        await syncUserProfile(currentUser);
        syncToReactAuth(userProfile);
        window.dispatchEvent(new Event('storage'));
      }

      interceptReactLoginLogout();
    } catch (err) {
      console.warn('[Auth] 初始化失敗:', err);
    }
  }

  // ==================== 用戶資料同步 ====================
  async function syncUserProfile(user) {
    if (!user || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('users').select('*').eq('id', user.id).single();

      if (error && error.code === 'PGRST116') {
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
        const { data: created } = await supabase.from('users').insert(newProfile).select().single();
        userProfile = created || newProfile;
      } else if (data) {
        userProfile = data;
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
    try {
      const users = JSON.parse(localStorage.getItem('registered_users') || '[]');
      const idx = users.findIndex(u => u.email === profile.email);
      if (idx >= 0) {
        users[idx] = { ...users[idx], ...reactUser, password: users[idx].password };
      } else {
        users.push({ ...reactUser, password: '__supabase__' });
      }
      localStorage.setItem('registered_users', JSON.stringify(users));
    } catch (e) {}
  }

  // ==================== 攔截 React 的 localStorage 操作 ====================
  // 關鍵：Jg（LikeButton）用 likes/bookmarks（Set 序列化為 Array）
  //       Wk（LikesContext）用 likedTheories/bookmarkedTheories（Array）
  //       兩個系統互不監聽，需要雙向同步
  //       同時需要同步到 Supabase content_likes/content_bookmarks 表格
  function interceptReactLoginLogout() {
    const origSetItem = localStorage.setItem.bind(localStorage);
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    let _syncing = false;

    localStorage.setItem = function (key, value) {
      origSetItem(key, value);
      if (_syncing) return;
      _syncing = true;
      try {
        // Jg 更新 likes → 同步到 likedTheories（供 Wk 讀取）
        if (key === 'likes') {
          const ids = JSON.parse(value) || [];
          origSetItem('likedTheories', JSON.stringify(ids));
          // 同步到 Supabase（非同步，不阻塞）
          if (currentUser && supabase) {
            syncLikesToSupabase(ids).catch(() => {});
          }
          // 更新 philosophy_philosophers 中的 theory.likes 計數
          updateTheoryLikeCounts(ids, origSetItem);
        }
        // Wk 更新 likedTheories → 同步到 likes（供 Jg 讀取）
        else if (key === 'likedTheories') {
          const ids = JSON.parse(value) || [];
          origSetItem('likes', JSON.stringify(ids));
          // 同步到 Supabase（非同步，不阻塞）
          if (currentUser && supabase) {
            syncLikesToSupabase(ids).catch(() => {});
          }
          // 更新 philosophy_philosophers 中的 theory.likes 計數
          updateTheoryLikeCounts(ids, origSetItem);
        }
        // Jg 更新 bookmarks → 同步到 bookmarkedTheories
        if (key === 'bookmarks') {
          const ids = JSON.parse(value) || [];
          origSetItem('bookmarkedTheories', JSON.stringify(ids));
          if (currentUser && supabase) {
            syncBookmarksToSupabase(ids).catch(() => {});
          }
        }
        // Wk 更新 bookmarkedTheories → 同步到 bookmarks
        else if (key === 'bookmarkedTheories') {
          const ids = JSON.parse(value) || [];
          origSetItem('bookmarks', JSON.stringify(ids));
          if (currentUser && supabase) {
            syncBookmarksToSupabase(ids).catch(() => {});
          }
        }
      } catch (e) {}
      _syncing = false;
    };

    localStorage.removeItem = function (key) {
      origRemoveItem(key);
      if (key === 'user' && currentUser && supabase) {
        supabase.auth.signOut().catch(() => {});
        currentUser = null;
        userProfile = null;
      }
    };
  }

  // ==================== 更新 theory.likes 計數 ====================
  // 當用戶按讚時，更新 localStorage.philosophy_philosophers 中的 theory.likes
  // 這樣首頁熱門理論在重新載入時會顯示正確數字
  function updateTheoryLikeCounts(likedIds, origSetItem) {
    try {
      const philosophers = JSON.parse(localStorage.getItem('philosophy_philosophers') || '[]');
      let changed = false;
      for (const phil of philosophers) {
        if (!phil.theories) continue;
        for (const theory of phil.theories) {
          const isLiked = likedIds.includes(theory.id);
          const expectedLikes = isLiked ? 1 : 0;
          if (theory.likes !== expectedLikes) {
            theory.likes = expectedLikes;
            changed = true;
          }
        }
      }
      if (changed) {
        origSetItem('philosophy_philosophers', JSON.stringify(philosophers));
      }
    } catch (e) {}
  }

  // ==================== 同步按讚到 Supabase ====================
  let _likeSyncTimer = null;
  let _lastLikeIds = null;

  async function syncLikesToSupabase(ids) {
    if (!currentUser || !supabase) return;
    const idsStr = JSON.stringify(ids.slice().sort());
    if (idsStr === _lastLikeIds) return;
    _lastLikeIds = idsStr;

    clearTimeout(_likeSyncTimer);
    _likeSyncTimer = setTimeout(async () => {
      try {
        // 讀取現有的按讚記錄（用 content_title 儲存原始字串 ID）
        const { data: existing } = await supabase
          .from('content_likes')
          .select('id,content_id,content_title')
          .eq('user_id', currentUser.id);

        // 用 content_title 作為原始 ID（如果有），否則用 content_id
        const existingMap = {}; // originalId -> row.id
        (existing || []).forEach(r => {
          const origId = r.content_title || r.content_id;
          existingMap[origId] = r.id;
        });
        const existingOrigIds = Object.keys(existingMap);

        const toAdd = ids.filter(id => !existingOrigIds.includes(id));
        const toRemoveIds = existingOrigIds
          .filter(origId => !ids.includes(origId))
          .map(origId => existingMap[origId]); // row.id

        if (toAdd.length > 0) {
          const rows = toAdd.map(id => ({
            user_id: currentUser.id,
            content_id: stringToUUID(id),
            content_type: 'theory',
            content_title: id // 儲存原始字串 ID，方便後續查詢
          }));
          await supabase.from('content_likes').insert(rows);
        }

        if (toRemoveIds.length > 0) {
          await supabase.from('content_likes')
            .delete()
            .eq('user_id', currentUser.id)
            .in('id', toRemoveIds);
        }
      } catch (err) {
        console.warn('[Auth] 同步按讚到 Supabase 失敗:', err);
      }
    }, 1000);
  }

  let _bookmarkSyncTimer = null;
  let _lastBookmarkIds = null;

  async function syncBookmarksToSupabase(ids) {
    if (!currentUser || !supabase) return;
    const idsStr = JSON.stringify(ids.slice().sort());
    if (idsStr === _lastBookmarkIds) return;
    _lastBookmarkIds = idsStr;

    clearTimeout(_bookmarkSyncTimer);
    _bookmarkSyncTimer = setTimeout(async () => {
      try {
        // 讀取現有的收藏記錄
        const { data: existing } = await supabase
          .from('content_bookmarks')
          .select('id,content_id,content_title')
          .eq('user_id', currentUser.id);

        const existingMap = {};
        (existing || []).forEach(r => {
          const origId = r.content_title || r.content_id;
          existingMap[origId] = r.id;
        });
        const existingOrigIds = Object.keys(existingMap);

        const toAdd = ids.filter(id => !existingOrigIds.includes(id));
        const toRemoveIds = existingOrigIds
          .filter(origId => !ids.includes(origId))
          .map(origId => existingMap[origId]);

        if (toAdd.length > 0) {
          const rows = toAdd.map(id => ({
            user_id: currentUser.id,
            content_id: stringToUUID(id),
            content_type: 'theory',
            content_title: id // 儲存原始字串 ID
          }));
          await supabase.from('content_bookmarks').insert(rows);
        }

        if (toRemoveIds.length > 0) {
          await supabase.from('content_bookmarks')
            .delete()
            .eq('user_id', currentUser.id)
            .in('id', toRemoveIds);
        }
      } catch (err) {
        console.warn('[Auth] 同步收藏到 Supabase 失敗:', err);
      }
    }, 1000);
  }

  // ==================== 字串 ID 轉換為確定性 UUID ====================
  // 將如 'thales-water' 這樣的字串 ID 轉換為 UUID 格式
  function stringToUUID(str) {
    // 简單的 hash 函數，產生確定性的 UUID v4 格式
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32-bit integer
    }
    // 將 hash 轉換為 UUID 格式
    const h = Math.abs(hash).toString(16).padStart(8, '0');
    const h2 = Math.abs(hash * 1234567).toString(16).padStart(8, '0');
    const h3 = Math.abs(hash * 9876543).toString(16).padStart(8, '0');
    const h4 = Math.abs(hash * 1111111).toString(16).padStart(8, '0');
    return `${h.slice(0,8)}-${h2.slice(0,4)}-4${h3.slice(0,3)}-${h4.slice(0,4)}-${h.slice(0,4)}${h2.slice(0,8)}`;
  }

  function getContentTitle(id) {
    try {
      const philosophers = JSON.parse(localStorage.getItem('philosophy_philosophers') || '[]');
      for (const phil of philosophers) {
        if (phil.theories) {
          for (const theory of phil.theories) {
            if (theory.id === id) return theory.title || id;
          }
        }
      }
    } catch (e) {}
    return id;
  }

  // ==================== 修復 baseCount:128 硬編碼問題 ====================
  function fixHardcodedLikeCounts() {
    function doFix() {
      const allButtons = document.querySelectorAll('button');
      allButtons.forEach(btn => {
        const spans = btn.querySelectorAll('span');
        spans.forEach(span => {
          const text = span.textContent?.trim();
          if (text === '128' || text === '129') {
            const isLiked = btn.classList.contains('text-red-500') ||
                           btn.querySelector('.text-red-500') !== null;
            span.textContent = isLiked ? '1' : '0';
          }
          if (text === '56' || text === '57') {
            const isBookmarked = btn.classList.contains('text-yellow-500') ||
                                btn.querySelector('.text-yellow-500') !== null ||
                                btn.classList.contains('text-amber-500') ||
                                btn.querySelector('.text-amber-500') !== null;
            span.textContent = isBookmarked ? '1' : '0';
          }
        });
      });
    }

    const obs = new MutationObserver(() => {
      const body = document.body?.textContent || '';
      if (body.includes('128') || body.includes('129') || body.includes('56') || body.includes('57')) {
        setTimeout(doFix, 50);
      }
    });

    function start() {
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      [100, 300, 500, 1000, 2000].forEach(t => setTimeout(doFix, t));
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ==================== 初始化按讚/收藏同步 ====================
  function initLikesSync() {
    try {
      const likes = JSON.parse(localStorage.getItem('likes') || '[]');
      const likedTheories = JSON.parse(localStorage.getItem('likedTheories') || '[]');
      const bookmarks = JSON.parse(localStorage.getItem('bookmarks') || '[]');
      const bookmarkedTheories = JSON.parse(localStorage.getItem('bookmarkedTheories') || '[]');

      const mergedLikes = [...new Set([...likes, ...likedTheories])];
      const mergedBookmarks = [...new Set([...bookmarks, ...bookmarkedTheories])];

      const orig = localStorage.setItem.bind(localStorage);
      orig('likes', JSON.stringify(mergedLikes));
      orig('likedTheories', JSON.stringify(mergedLikes));
      orig('bookmarks', JSON.stringify(mergedBookmarks));
      orig('bookmarkedTheories', JSON.stringify(mergedBookmarks));
    } catch (e) {}
  }

  // ==================== 後台地區同步到前台 ====================
  function injectExtraRegions() {
    const HARDCODED_REGIONS = ['western', 'eastern', 'indian', 'islamic'];

    function getExtraRegions() {
      try {
        const regions = JSON.parse(localStorage.getItem('philosophy_regions') || '[]');
        return regions.filter(r => !HARDCODED_REGIONS.includes(r.id));
      } catch (e) { return []; }
    }

    function escHtml(str) {
      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function createRegionCard(region) {
      const card = document.createElement('div');
      card.setAttribute('data-injected-region', region.id);
      card.style.cssText = 'cursor:pointer;';

      const colors = [
        'from-purple-500/20 to-pink-500/20',
        'from-teal-500/20 to-cyan-500/20',
        'from-yellow-500/20 to-amber-500/20',
        'from-rose-500/20 to-red-500/20'
      ];
      const color = colors[Math.abs((region.name || '').charCodeAt(0) || 0) % colors.length];

      card.innerHTML = `
        <div class="group relative bg-gradient-to-b from-[#111] to-[#0a0a0a] border border-[#c9a86c]/10 rounded-xl p-6 hover:border-[#c9a86c]/30 transition-all duration-300 hover:-translate-y-2 h-full overflow-hidden" style="min-height:200px;">
          <div class="absolute inset-0 bg-gradient-to-br ${color} opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <div class="relative z-10">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-14 h-14 rounded-xl bg-[#c9a86c]/10 flex items-center justify-center group-hover:bg-[#c9a86c]/20 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-[#c9a86c]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
              </div>
              <div>
                <h3 class="text-2xl font-serif text-white group-hover:text-[#c9a86c] transition-colors">${escHtml(region.name)}</h3>
                <p class="text-white/40 text-sm">${escHtml(region.nameEn || region.name)}</p>
              </div>
            </div>
            <p class="text-white/60 text-sm leading-relaxed mb-4">${escHtml(region.description || '')}</p>
            <div class="flex items-center text-[#c9a86c] text-sm mt-4">
              <span>探索該地區</span>
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-2 opacity-0 group-hover:opacity-100 transform group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </div>
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        const regionId = region.id;
        try {
          window.history.pushState({}, '', `/region/${regionId}`);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (e) {
          window.location.hash = `/region/${regionId}`;
        }
      });

      return card;
    }

    function tryInjectRegions() {
      const extraRegions = getExtraRegions();
      if (extraRegions.length === 0) return;

      // 找到地區卡片容器：包含 /region/ 連結的 grid
      const allLinks = document.querySelectorAll('a[href*="/region/"]');
      if (allLinks.length === 0) return;

      // 找到包含這些連結的 grid 容器
      let container = null;
      for (const link of allLinks) {
        const parent = link.closest('.grid, [class*="grid-cols"]');
        if (parent) { container = parent; break; }
      }

      if (!container) {
        // 備用：找到第一個連結的父容器
        const firstLink = allLinks[0];
        container = firstLink.parentElement?.parentElement?.parentElement;
      }

      if (!container) return;

      extraRegions.forEach(region => {
        if (container.querySelector(`[data-injected-region="${region.id}"]`)) return;
        const card = createRegionCard(region);
        container.appendChild(card);
      });
    }

    const obs = new MutationObserver(() => {
      if (document.querySelector('a[href*="/region/"]')) {
        setTimeout(tryInjectRegions, 100);
      }
    });

    function start() {
      obs.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('popstate', () => setTimeout(tryInjectRegions, 200));
      [500, 1000, 2000, 3000].forEach(t => setTimeout(tryInjectRegions, t));
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ==================== 攔截 React Navbar 的登入/登出按鈕 ====================
  function interceptNavbarButtons() {
    function tryIntercept() {
      const navbar = document.querySelector('header[role="banner"], header, nav');
      if (!navbar) return;

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
        if ((txt === '管理員' || txt.includes('管理員')) && !btn.dataset.intercepted) {
          btn.dataset.intercepted = '1';
          btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = './admin/index.html';
          }, true);
        }
      });

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
        if (href.includes('/admin') && !a.dataset.intercepted) {
          a.dataset.intercepted = '1';
          a.addEventListener('click', e => {
            e.preventDefault();
            e.stopImmediatePropagation();
            window.location.href = './admin/index.html';
          }, true);
        }
      });

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
    }

    const obs = new MutationObserver(() => setTimeout(tryIntercept, 100));
    function start() {
      obs.observe(document.body, { childList: true, subtree: true });
      [200, 500, 1000, 2000].forEach(t => setTimeout(tryIntercept, t));
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }

  // ==================== 公開 API ====================
  window.loginUser = async (email, password) => {
    if (!supabase) { showToast('系統初始化中，請稍後再試', 'error'); return false; }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.message.includes('Invalid login credentials')) showToast('信箱或密碼錯誤', 'error');
        else if (error.message.includes('Email not confirmed')) showToast('請先驗證您的信箱', 'error');
        else showToast('登入失敗：' + error.message, 'error');
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

  window.logoutUser = async () => {
    if (supabase) await supabase.auth.signOut();
    currentUser = null;
    userProfile = null;
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('storage'));
    showToast('已登出', 'success');
    setTimeout(() => window.location.href = './', 500);
  };

  window.isAdmin = () => {
    if (currentUser && currentUser.email === ADMIN_EMAIL) return true;
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      return u.isAdmin || u.email === ADMIN_EMAIL;
    } catch (e) { return false; }
  };

  window.getCurrentUser = () => currentUser;
  window.getUserProfile = () => userProfile;

  // ==================== 登入/註冊模態框 ====================
  window.showLoginModal = () => {
    document.getElementById('auth-modal-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'auth-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `
      <div style="background:#1a1a1a;border:1px solid rgba(212,175,55,0.3);border-radius:16px;padding:32px;width:100%;max-width:400px;position:relative;">
        <button onclick="document.getElementById('auth-modal-overlay').remove()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;">&#x2715;</button>
        <h2 style="color:#d4af37;font-size:20px;margin-bottom:24px;text-align:center;">登入</h2>
        <div id="auth-error" style="display:none;background:rgba(244,67,54,0.1);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:16px;"></div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">電子信箱</label>
          <input id="auth-email" type="email" placeholder="your@email.com" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
        </div>
        <div style="margin-bottom:24px;">
          <label style="display:block;font-size:13px;color:#888;margin-bottom:6px;">密碼</label>
          <input id="auth-password" type="password" placeholder="&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
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
        <button onclick="document.getElementById('auth-modal-overlay').remove()" style="position:absolute;top:12px;right:16px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;">&#x2715;</button>
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
          <input id="reg-password" type="password" placeholder="&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;" style="width:100%;padding:10px 14px;background:#2a2a2a;border:1px solid #444;border-radius:8px;color:#fff;font-size:14px;outline:none;box-sizing:border-box;" />
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
    const colors = {
      success: { bg: '#1a3a1a', border: '#4caf50', text: '#4caf50' },
      error: { bg: '#3a1a1a', border: '#f44336', text: '#f44336' }
    };
    const c = colors[type] || { bg: '#1a2a3a', border: '#2196f3', text: '#2196f3' };
    toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;font-size:14px;z-index:99998;background:' + c.bg + ';border:1px solid ' + c.border + ';color:' + c.text + ';white-space:nowrap;';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ==================== 啟動 ====================
  function startup() {
    initLikesSync();
    init();
    interceptNavbarButtons();
    fixHardcodedLikeCounts();
    injectExtraRegions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startup);
  } else {
    startup();
  }

})();
