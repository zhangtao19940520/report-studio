export interface Settings {
  fontSize: 'small' | 'medium' | 'large'
  themeColor: string
  theme: 'dark' | 'light'
}

export const FONT_SIZES: { key: Settings['fontSize']; label: string; zoom: number }[] = [
  { key: 'small', label: '小', zoom: 0.9 },
  { key: 'medium', label: '中', zoom: 1 },
  { key: 'large', label: '大', zoom: 1.15 }
]

export const THEME_COLORS: { value: string; label: string }[] = [
  { value: '#e05d38', label: '赤橙' },
  { value: '#4a9eda', label: '青蓝' },
  { value: '#5aa469', label: '松绿' },
  { value: '#9a6bd8', label: '紫藤' },
  { value: '#c9a227', label: '鎏金' }
]

const KEY = 'report-studio-settings'
export const DEFAULT_SETTINGS: Settings = { fontSize: 'medium', themeColor: '#e05d38', theme: 'dark' }

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      fontSize: FONT_SIZES.some((f) => f.key === parsed.fontSize)
        ? (parsed.fontSize as Settings['fontSize'])
        : DEFAULT_SETTINGS.fontSize,
      themeColor:
        typeof parsed.themeColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.themeColor)
          ? parsed.themeColor
          : DEFAULT_SETTINGS.themeColor,
      theme: parsed.theme === 'light' ? 'light' : 'dark'
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function applySettings(s: Settings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.style.setProperty('--accent', s.themeColor)
  // 清理历史版本遗留的 body zoom（HMR 场景下旧缩放可能残留）
  document.body.style.zoom = ''
  const scale = FONT_SIZES.find((f) => f.key === s.fontSize)?.zoom ?? 1
  // 用 transform 缩放并反向补偿宽高，保证布局仍占满视口且底部内容可达
  const app = document.querySelector<HTMLElement>('.app')
  if (app) {
    app.style.transform = `scale(${scale})`
    app.style.width = `${100 / scale}%`
    app.style.height = `${100 / scale}%`
  }
}
