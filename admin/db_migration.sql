-- ============================================================
-- 源 哲學網 - 資料庫遷移腳本
-- 建立層級化哲學內容管理所需的表格
-- ============================================================

-- 1. 確保 regions 表格有正確結構（已存在）
-- regions: id, name, description, created_at

-- 2. 確保 eras 表格有正確結構（已存在但空）
-- eras: id, name, region_id, period, description, created_at
ALTER TABLE IF EXISTS eras ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 3. 確保 philosophers 表格有正確結構（已存在但空）
-- philosophers: id, name, era_id, birth_year, death_year, description, theories, created_at
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS name_en text;
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS birthplace text;
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS biography text;
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS core_ideas text;
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS works text;
ALTER TABLE IF EXISTS philosophers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 4. 確保 theories 表格有正確結構（已存在但空）
-- theories: id, title, philosopher_id, category_id, summary, content, created_at
ALTER TABLE IF EXISTS theories ADD COLUMN IF NOT EXISTS full_argument text;
ALTER TABLE IF EXISTS theories ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 5. 確保 rebuttals 表格有正確結構（已存在但空）
-- rebuttals: id, theory_id, critic, title, content, created_at
ALTER TABLE IF EXISTS rebuttals ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 6. 確保 questions 表格有正確結構（已存在但空）
-- questions: id, title, field, description, content, created_at
ALTER TABLE IF EXISTS questions ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE IF EXISTS questions ADD COLUMN IF NOT EXISTS school_count integer DEFAULT 0;
ALTER TABLE IF EXISTS questions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 7. 建立 theory_categories 表格（哲學理論的領域分類）
CREATE TABLE IF NOT EXISTS theory_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  title_en text,
  description text,
  philosopher_count integer DEFAULT 0,
  school_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 8. 建立 theory_schools 表格（哲學理論的學派/哲學家）
CREATE TABLE IF NOT EXISTS theory_schools (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  category_id uuid REFERENCES theory_categories(id) ON DELETE CASCADE,
  view_summary text,
  description text,
  created_at timestamptz DEFAULT now()
);

-- 9. 建立 theory_arguments 表格（哲學理論的論證）
CREATE TABLE IF NOT EXISTS theory_arguments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  content text,
  school_id uuid REFERENCES theory_schools(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 10. 建立 theory_rebuttals 表格（哲學理論的批判與反駁）
CREATE TABLE IF NOT EXISTS theory_rebuttals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  critic text NOT NULL,
  title text,
  content text NOT NULL,
  argument_id uuid REFERENCES theory_arguments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 11. 建立 question_schools 表格（哲學問題的學派）
CREATE TABLE IF NOT EXISTS question_schools (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  view_summary text,
  description text,
  created_at timestamptz DEFAULT now()
);

-- 12. 建立 question_arguments 表格（哲學問題的論證）
CREATE TABLE IF NOT EXISTS question_arguments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  content text,
  school_id uuid REFERENCES question_schools(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 13. 建立 question_rebuttals 表格（哲學問題的批判與反駁）
CREATE TABLE IF NOT EXISTS question_rebuttals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  critic text NOT NULL,
  title text,
  content text NOT NULL,
  argument_id uuid REFERENCES question_arguments(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 14. 建立 new_thinkers 表格（新思想家）
CREATE TABLE IF NOT EXISTS new_thinkers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  background text,
  avatar_url text,
  created_at timestamptz DEFAULT now()
);

-- 15. 建立 thinker_contents 表格（新思想家的理論/問題）
CREATE TABLE IF NOT EXISTS thinker_contents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  type text DEFAULT '哲學理論',
  description text,
  content text,
  thinker_id uuid REFERENCES new_thinkers(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

-- 16. 確保 submissions 表格有 status 欄位
ALTER TABLE IF EXISTS submissions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE IF EXISTS submissions ADD COLUMN IF NOT EXISTS admin_note text;
ALTER TABLE IF EXISTS submissions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 17. 確保 reports 表格有 status 欄位
ALTER TABLE IF EXISTS reports ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';

-- 啟用 RLS（Row Level Security）
ALTER TABLE theory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE theory_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE theory_arguments ENABLE ROW LEVEL SECURITY;
ALTER TABLE theory_rebuttals ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_arguments ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_rebuttals ENABLE ROW LEVEL SECURITY;
ALTER TABLE new_thinkers ENABLE ROW LEVEL SECURITY;
ALTER TABLE thinker_contents ENABLE ROW LEVEL SECURITY;

-- 建立 RLS 政策（允許所有人讀取，只有認證用戶可以寫入）
CREATE POLICY IF NOT EXISTS "Allow public read" ON theory_categories FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON theory_schools FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON theory_arguments FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON theory_rebuttals FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON question_schools FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON question_arguments FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON question_rebuttals FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON new_thinkers FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Allow public read" ON thinker_contents FOR SELECT USING (true);

-- 允許認證用戶寫入（管理員操作）
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON theory_categories FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON theory_schools FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON theory_arguments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON theory_rebuttals FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON question_schools FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON question_arguments FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON question_rebuttals FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON new_thinkers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY IF NOT EXISTS "Allow authenticated write" ON thinker_contents FOR ALL USING (auth.role() = 'authenticated');
