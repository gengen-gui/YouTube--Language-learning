import { useEffect, useState } from 'react';
import { Api, LANGS, saveAuth, clearAuth, currentEmail, type VocabItem, type Cue } from './api';

type Tab = 'book' | 'study';

export default function App() {
  const [email, setEmail] = useState<string | null>(currentEmail());

  if (!email) return <Auth onAuthed={setEmail} />;
  return <Dashboard email={email} onLogout={() => { clearAuth(); setEmail(null); }} />;
}

// ---------------- Auth ----------------
function Auth({ onAuthed }: { onAuthed: (email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const res = mode === 'login' ? await Api.login(email, password) : await Api.register(email, password);
      saveAuth(res.token, res.user.email);
      onAuthed(res.user.email);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit}>
        <h1><span className="dot" /> YT Lingo</h1>
        <p className="sub">在 YouTube 学语言 · 我的生词本</p>
        <input placeholder="邮箱" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input placeholder="密码 (至少 6 位)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {err && <div className="err">{err}</div>}
        <button disabled={busy}>{busy ? '请稍候...' : mode === 'login' ? '登录' : '注册'}</button>
        <div className="switch">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <a onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? '去注册' : '去登录'}
          </a>
        </div>
      </form>
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard({ email, onLogout }: { email: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('book');
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="dot" /> YT Lingo</div>
        <nav className="tabs">
          <button className={tab === 'book' ? 'active' : ''} onClick={() => setTab('book')}>📖 生词本</button>
          <button className={tab === 'study' ? 'active' : ''} onClick={() => setTab('study')}>🎬 学习</button>
        </nav>
        <div className="user">{email} <a onClick={onLogout}>退出</a></div>
      </header>
      <main>{tab === 'book' ? <VocabBook /> : <Study />}</main>
    </div>
  );
}

// ---------------- Vocab Book ----------------
function VocabBook() {
  const [items, setItems] = useState<VocabItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load() {
    setLoading(true);
    try {
      const { items } = await Api.listVocab();
      setItems(items);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function retranslate(id: number, lang: string) {
    const { item } = await Api.retranslate(id, lang);
    setItems((prev) => prev.map((it) => (it.id === id ? item : it)));
  }
  async function remove(id: number) {
    await Api.removeVocab(id);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  if (loading) return <div className="center muted">加载中...</div>;
  if (err) return <div className="center err">{err}</div>;
  if (!items.length) return <div className="center muted">还没有收藏。去「学习」标签或用浏览器扩展，在 YouTube 上点击句子收藏吧！</div>;

  return (
    <div className="book">
      {items.map((it) => (
        <div className="card vocab" key={it.id}>
          <div className="vocab-text">{it.text}</div>
          <div className="vocab-trans">{it.translation || <span className="muted">（未翻译）</span>}</div>
          <div className="vocab-meta">
            {it.video_title && (
              <a
                href={`https://www.youtube.com/watch?v=${it.video_id}${it.start_time != null ? `&t=${Math.floor(it.start_time)}s` : ''}`}
                target="_blank"
                rel="noreferrer"
                title={it.video_title}
              >
                🔗 {it.video_title.slice(0, 40)}{it.video_title.length > 40 ? '…' : ''}
              </a>
            )}
            <select value={it.target_lang} onChange={(e) => retranslate(it.id, e.target.value)}>
              {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className="ghost danger" onClick={() => remove(it.id)}>删除</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Study by URL ----------------
function Study() {
  const [url, setUrl] = useState('');
  const [lang, setLang] = useState('en');
  const [target, setTarget] = useState('zh-CN');
  const [data, setData] = useState<{ videoId: string; title: string; cues: Cue[] } | null>(null);
  const [blocked, setBlocked] = useState<{ videoId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState<Record<number, boolean>>({});

  function parseId(input: string): string | null {
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    try {
      const u = new URL(input);
      if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
      return u.searchParams.get('v');
    } catch {
      return null;
    }
  }

  async function fetchCaptions(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    setData(null);
    setBlocked(null);
    setSaved({});
    try {
      const res = await Api.captions(url, lang);
      setData({ videoId: res.videoId, title: res.title, cues: res.cues });
    } catch (e) {
      const msg = (e as Error).message;
      // Server-side captions blocked by YouTube -> still show the player.
      if (msg === 'CAPTIONS_BLOCKED') {
        const id = parseId(url.trim());
        if (id) setBlocked({ videoId: id });
      }
      setErr(msg === 'CAPTIONS_BLOCKED' ? '' : msg);
    } finally {
      setBusy(false);
    }
  }

  async function save(cue: Cue, idx: number) {
    if (!data) return;
    await Api.addVocab({
      text: cue.text,
      targetLang: target,
      videoId: data.videoId,
      videoTitle: data.title,
      startTime: cue.start,
    });
    setSaved((s) => ({ ...s, [idx]: true }));
  }

  return (
    <div className="study">
      <form className="card study-bar" onSubmit={fetchCaptions}>
        <input
          placeholder="粘贴 YouTube 链接或视频 ID"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select value={lang} onChange={(e) => setLang(e.target.value)} title="字幕语言">
          {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button disabled={busy}>{busy ? '抓取中...' : '获取字幕'}</button>
      </form>

      <div className="study-target">
        收藏时翻译为：
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {err && <div className="center err">{err}</div>}

      {blocked && (
        <>
          <div className="card notice">
            <strong>该视频的字幕无法从服务器端获取。</strong>
            <p>
              YouTube 限制了服务器端下载字幕。请安装并使用 <b>YT Lingo 浏览器扩展</b>，
              直接在 YouTube 视频页实时抓取字幕并收藏——收藏内容会同步到这里的生词本。
            </p>
          </div>
          <div className="study-video">
            <iframe
              src={`https://www.youtube.com/embed/${blocked.videoId}`}
              title="video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </>
      )}

      {data && (
        <>
          <div className="study-video">
            <iframe
              src={`https://www.youtube.com/embed/${data.videoId}`}
              title={data.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
            <h3>{data.title}</h3>
          </div>
          <div className="cues">
            {data.cues.map((c, i) => (
              <div className="cue" key={i}>
                <span className="cue-time">{fmt(c.start)}</span>
                <span className="cue-text">{c.text}</span>
                <button
                  className={saved[i] ? 'ghost saved' : 'ghost'}
                  disabled={saved[i]}
                  onClick={() => save(c, i)}
                >
                  {saved[i] ? '✓ 已收藏' : '★ 收藏'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
