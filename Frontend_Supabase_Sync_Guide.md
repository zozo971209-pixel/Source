# 「源」哲學網站：前台與 Supabase 資料庫完全同步技術指南

**作者：Manus AI**
**日期：2026年3月18日**

本文件旨在提供一份詳細的技術指南，說明如何將「源」哲學網站（目前為 React 靜態編譯版）與 Supabase 資料庫進行完全同步。目前網站的後台管理系統已成功與 Supabase 介接，能夠進行層級化的資料增刪改查，但前台展示層仍依賴於編譯時寫死在 JavaScript 檔案中的靜態資料。為了實現真正的動態內容管理，必須對前台原始碼進行重構。

## 1. 現有架構分析

### 1.1 前台資料流現況
經過對前台編譯後檔案（`assets/index-0IGz-JVJ.js`）的深入分析，確認目前前台**完全沒有**向 Supabase 發起資料庫查詢（`.from()` 呼叫）。所有的哲學家、理論、論證、批判及問題資料，皆以巨大的 JSON 物件形式硬編碼於 JavaScript 中。

前台目前僅在 `auth-supabase.js` 中使用了 Supabase 的**認證功能**（Authentication），用於處理用戶登入、註冊及權限驗證，並將用戶資料同步至 `users` 表格。

### 1.2 Supabase 資料庫結構
後台已建立完整的關聯式資料庫結構，包含以下核心表格：

| 表格名稱 | 說明 | 關聯鍵 |
|---|---|---|
| `regions` | 哲學地區（西方、東方等） | 無 |
| `eras` | 哲學時代 | `region_id` |
| `philosophers` | 哲學家基本資料 | `era_id` |
| `theory_categories` | 理論分類（形上學、倫理學等） | 無 |
| `schools` | 哲學學派 | 無 |
| `theories` | 哲學理論 | `philosopher_id`, `category_id`, `school_id` |
| `questions` | 核心哲學問題 | 無 |
| `arguments` | 論證內容 | `philosopher_id`, `theory_id`, `question_id` |
| `rebuttals` | 批判與反駁 | `argument_id`, `philosopher_id` |

## 2. 資料遷移與同步策略

要實現完全同步，必須從「靜態資料驅動」轉向「API 驅動」的架構。這需要取得 React 專案的**原始碼**（Source Code），而非目前的編譯後版本（Build）。

### 2.1 取得並重構 React 原始碼
由於目前 GitHub 倉庫中僅包含編譯後的靜態檔案（HTML/CSS/JS），您需要：
1. 找到原始的 React 專案資料夾（通常包含 `src/`, `package.json`, `vite.config.js` 等）。
2. 在專案中安裝 Supabase 客戶端：`npm install @supabase/supabase-js`。
3. 建立統一的 Supabase 客戶端實例檔案（例如 `src/lib/supabase.js`）。

### 2.2 狀態管理替換
前台目前可能使用 Context API、Redux 或單純的 React State 來管理靜態資料。重構時，應引入非同步資料獲取機制（如 React Query 或 SWR），以處理載入中（Loading）、錯誤（Error）及快取（Caching）狀態。

## 3. API 整合方案與實作步驟

以下提供具體的程式碼實作範例，說明如何在 React 原始碼中替換靜態資料。

### 步驟一：建立 Supabase 客戶端

在 `src/lib/supabase.js` 中初始化連線：

```javascript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

### 步驟二：實作資料獲取 Hook (以哲學時代為例)

替換原本直接讀取靜態陣列的邏輯，改為非同步向 Supabase 請求資料。

```javascript
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export function useErasWithPhilosophers() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // 使用 Supabase 的關聯查詢功能，一次取得時代及其下的哲學家
      const { data: eras, error } = await supabase
        .from('eras')
        .select(`
          id, name, period, description,
          philosophers ( id, name, birth_year, death_year, avatar )
        `)
        .order('created_at');
        
      if (!error && eras) {
        setData(eras);
      }
      setLoading(false);
    }
    fetchData();
  }, []);

  return { data, loading };
}
```

### 步驟三：實作複雜層級查詢 (以哲學家詳細頁面為例)

哲學家頁面需要展示其生平、理論、論證及批判，這需要多層級的關聯查詢。

```javascript
export async function getPhilosopherDetails(philosopherId) {
  // 1. 取得基本資料
  const { data: philosopher } = await supabase
    .from('philosophers')
    .select('*')
    .eq('id', philosopherId)
    .single();

  // 2. 取得該哲學家的理論，以及理論下的論證和批判
  const { data: theories } = await supabase
    .from('theories')
    .select(`
      id, name, description, content,
      arguments (
        id, title, content, type,
        rebuttals ( id, title, content )
      )
    `)
    .eq('philosopher_id', philosopherId);

  return { ...philosopher, theories };
}
```

### 步驟四：處理哲學問題的跨表關聯

哲學問題模組（如電車難題）涉及多個學派和哲學家的論證，查詢邏輯如下：

```javascript
export async function getQuestionDetails(questionId) {
  const { data: question } = await supabase
    .from('questions')
    .select(`
      id, title, description, content,
      arguments (
        id, title, content, type, philosopher_id,
        philosophers ( name ),
        rebuttals ( id, title, content )
      )
    `)
    .eq('id', questionId)
    .single();
    
  return question;
}
```

## 4. 效能優化與注意事項

1. **開啟 RLS (Row Level Security)**：目前 Supabase 使用 Anon Key 進行查詢，必須在 Supabase 後台為所有表格開啟 RLS，並設定「允許所有人讀取 (SELECT)，僅允許管理員寫入 (INSERT/UPDATE/DELETE)」的政策，以確保資料安全。
2. **實作分頁與延遲載入**：當哲學家或理論數量增加時，一次載入所有資料會導致前台卡頓。應在 Supabase 查詢中加入 `.range(from, to)` 實作分頁。
3. **靜態網站生成 (SSG) 考量**：如果網站極度重視 SEO，建議將 React 專案遷移至 Next.js 或 Remix。這樣可以在建置時（Build time）從 Supabase 抓取資料生成靜態 HTML，兼顧動態管理與極致的載入速度。

## 結論

目前的架構已完成了最困難的「資料庫建模」與「後台管理系統建置」。接下來的關鍵步驟是**取得 React 原始碼**，並依照上述指南，將寫死的靜態 JSON 替換為 Supabase 的非同步 API 呼叫。完成這一步後，「源」哲學網站將成為一個完全動態、可由後台無限擴充內容的現代化 Web 應用程式。
