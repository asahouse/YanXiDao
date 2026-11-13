export interface PresetAvatar {
  id: string
  name: string
  category: string
  url: string
}

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`
}

export const PRESET_AVATARS: PresetAvatar[] = [
  {
    id: 'cat',
    name: '聪慧小猫',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <polygon points="25,48 18,15 46,30" fill="#f97316"/>
        <polygon points="27,42 22,22 42,32" fill="#fed7aa"/>
        <polygon points="95,48 102,15 74,30" fill="#f97316"/>
        <polygon points="93,42 98,22 78,32" fill="#fed7aa"/>
        <circle cx="60" cy="65" r="45" fill="#fb923c"/>
        <ellipse cx="44" cy="58" rx="7" ry="9" fill="#1e293b"/>
        <ellipse cx="76" cy="58" rx="7" ry="9" fill="#1e293b"/>
        <circle cx="46" cy="55" r="2.5" fill="#ffffff"/>
        <circle cx="78" cy="55" r="2.5" fill="#ffffff"/>
        <polygon points="60,67 54,62 66,62" fill="#ef4444"/>
        <path d="M 52,72 Q 60,78 68,72" fill="none" stroke="#7c2d12" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="20" y1="62" x2="42" y2="64" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
        <line x1="18" y1="70" x2="40" y2="69" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
        <line x1="100" y1="62" x2="78" y2="64" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
        <line x1="102" y1="70" x2="80" y2="69" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
        <!-- Glasses -->
        <circle cx="44" cy="58" r="14" fill="none" stroke="#0284c7" stroke-width="3"/>
        <circle cx="76" cy="58" r="14" fill="none" stroke="#0284c7" stroke-width="3"/>
        <line x1="58" y1="58" x2="62" y2="58" stroke="#0284c7" stroke-width="3"/>
      </svg>
    `)
  },
  {
    id: 'shiba',
    name: '阳光柴犬',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <polygon points="26,45 15,16 48,28" fill="#d97706"/>
        <polygon points="94,45 105,16 72,28" fill="#d97706"/>
        <circle cx="60" cy="65" r="45" fill="#f59e0b"/>
        <!-- White cheeks & eyebrows -->
        <circle cx="42" cy="46" r="4" fill="#ffffff"/>
        <circle cx="78" cy="46" r="4" fill="#ffffff"/>
        <ellipse cx="60" cy="74" rx="28" ry="22" fill="#fef3c7"/>
        <ellipse cx="44" cy="56" rx="5" ry="6" fill="#1e293b"/>
        <ellipse cx="76" cy="56" rx="5" ry="6" fill="#1e293b"/>
        <ellipse cx="60" cy="66" rx="7" ry="5" fill="#1e293b"/>
        <!-- Tongue -->
        <path d="M 56,73 Q 60,86 64,73" fill="#f43f5e"/>
      </svg>
    `)
  },
  {
    id: 'bear',
    name: '知识小熊',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <circle cx="28" cy="35" r="16" fill="#92400e"/>
        <circle cx="28" cy="35" r="9" fill="#fde68a"/>
        <circle cx="92" cy="35" r="16" fill="#92400e"/>
        <circle cx="92" cy="35" r="9" fill="#fde68a"/>
        <circle cx="60" cy="68" r="44" fill="#b45309"/>
        <ellipse cx="60" cy="76" rx="22" ry="16" fill="#fde68a"/>
        <ellipse cx="60" cy="70" rx="6" ry="4.5" fill="#1e293b"/>
        <circle cx="45" cy="58" r="5" fill="#1e293b"/>
        <circle cx="75" cy="58" r="5" fill="#1e293b"/>
        <circle cx="47" cy="56" r="1.5" fill="#ffffff"/>
        <circle cx="77" cy="56" r="1.5" fill="#ffffff"/>
        <!-- Graduation Cap -->
        <polygon points="60,12 25,25 60,38 95,25" fill="#1e1b4b"/>
        <polygon points="60,38 45,46 75,46" fill="#312e81"/>
        <line x1="90" y1="27" x2="95" y2="45" stroke="#f59e0b" stroke-width="2.5"/>
        <circle cx="95" cy="47" r="3" fill="#f59e0b"/>
      </svg>
    `)
  },
  {
    id: 'fox',
    name: '灵动小狐',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <polygon points="20,50 15,10 52,32" fill="#ea580c"/>
        <polygon points="24,44 19,18 45,32" fill="#ffffff"/>
        <polygon points="100,50 105,10 68,32" fill="#ea580c"/>
        <polygon points="96,44 101,18 75,32" fill="#ffffff"/>
        <circle cx="60" cy="68" r="44" fill="#f97316"/>
        <polygon points="20,68 60,105 60,68" fill="#ffffff"/>
        <polygon points="100,68 60,105 60,68" fill="#ffffff"/>
        <ellipse cx="44" cy="58" rx="6" ry="5" fill="#1e293b"/>
        <ellipse cx="76" cy="58" rx="6" ry="5" fill="#1e293b"/>
        <polygon points="60,86 54,80 66,80" fill="#1e293b"/>
        <!-- Leaf on head -->
        <path d="M 60,25 Q 75,18 72,32 Q 60,35 60,25" fill="#22c55e"/>
      </svg>
    `)
  },
  {
    id: 'panda',
    name: '国宝熊猫',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <circle cx="28" cy="30" r="16" fill="#0f172a"/>
        <circle cx="92" cy="30" r="16" fill="#0f172a"/>
        <circle cx="60" cy="65" r="45" fill="#f8fafc"/>
        <ellipse cx="42" cy="58" rx="12" ry="15" fill="#0f172a" transform="rotate(-15 42 58)"/>
        <ellipse cx="78" cy="58" rx="12" ry="15" fill="#0f172a" transform="rotate(15 78 58)"/>
        <circle cx="44" cy="56" r="4.5" fill="#ffffff"/>
        <circle cx="76" cy="56" r="4.5" fill="#ffffff"/>
        <circle cx="45" cy="55" r="2" fill="#0f172a"/>
        <circle cx="75" cy="55" r="2" fill="#0f172a"/>
        <ellipse cx="60" cy="72" rx="7" ry="5" fill="#0f172a"/>
        <!-- Pink cheeks -->
        <ellipse cx="30" cy="74" rx="7" ry="4" fill="#f43f5e" opacity="0.4"/>
        <ellipse cx="90" cy="74" rx="7" ry="4" fill="#f43f5e" opacity="0.4"/>
        <!-- Bamboo -->
        <rect x="78" y="80" width="6" height="30" rx="3" fill="#16a34a" transform="rotate(25 78 80)"/>
        <ellipse cx="92" cy="75" rx="7" ry="3" fill="#22c55e" transform="rotate(40 92 75)"/>
      </svg>
    `)
  },
  {
    id: 'dino',
    name: '呆萌恐龙',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Spikes -->
        <polygon points="60,10 52,24 68,24" fill="#eab308"/>
        <polygon points="40,16 34,28 48,28" fill="#eab308"/>
        <polygon points="80,16 72,28 86,28" fill="#eab308"/>
        <circle cx="60" cy="65" r="45" fill="#10b981"/>
        <ellipse cx="60" cy="78" rx="26" ry="18" fill="#a7f3d0"/>
        <circle cx="45" cy="55" r="6" fill="#0f172a"/>
        <circle cx="75" cy="55" r="6" fill="#0f172a"/>
        <circle cx="47" cy="53" r="2" fill="#ffffff"/>
        <circle cx="77" cy="53" r="2" fill="#ffffff"/>
        <!-- Cute smile -->
        <path d="M 53,70 Q 60,78 67,70" fill="none" stroke="#065f46" stroke-width="2.5" stroke-linecap="round"/>
        <!-- Cute tooth -->
        <polygon points="56,70 60,75 60,70" fill="#ffffff"/>
      </svg>
    `)
  },
  {
    id: 'rabbit',
    name: '活力小兔',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <ellipse cx="40" cy="25" rx="10" ry="24" fill="#f8fafc"/>
        <ellipse cx="40" cy="25" rx="5" ry="18" fill="#f472b6"/>
        <ellipse cx="80" cy="25" rx="10" ry="24" fill="#f8fafc"/>
        <ellipse cx="80" cy="25" rx="5" ry="18" fill="#f472b6"/>
        <circle cx="60" cy="70" r="42" fill="#f8fafc"/>
        <circle cx="45" cy="65" r="5" fill="#0f172a"/>
        <circle cx="75" cy="65" r="5" fill="#0f172a"/>
        <circle cx="46.5" cy="63" r="1.5" fill="#ffffff"/>
        <circle cx="76.5" cy="63" r="1.5" fill="#ffffff"/>
        <polygon points="60,73 56,69 64,69" fill="#ec4899"/>
        <path d="M 54,77 Q 60,82 66,77" fill="none" stroke="#db2777" stroke-width="2" stroke-linecap="round"/>
        <!-- Cheeks -->
        <circle cx="34" cy="73" r="5" fill="#fbcfe8"/>
        <circle cx="86" cy="73" r="5" fill="#fbcfe8"/>
      </svg>
    `)
  },
  {
    id: 'penguin',
    name: '极地企鹅',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <circle cx="60" cy="62" r="46" fill="#0f172a"/>
        <!-- Belly -->
        <ellipse cx="60" cy="68" rx="30" ry="36" fill="#ffffff"/>
        <circle cx="46" cy="52" r="4.5" fill="#0f172a"/>
        <circle cx="74" cy="52" r="4.5" fill="#0f172a"/>
        <polygon points="60,60 52,54 68,54" fill="#f59e0b"/>
        <!-- Scarf -->
        <rect x="30" y="80" width="60" height="12" rx="6" fill="#ef4444"/>
        <rect x="68" y="80" width="14" height="24" rx="4" fill="#dc2626"/>
      </svg>
    `)
  },
  {
    id: 'owl',
    name: '博学猫头鹰',
    category: '可爱萌宠',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <polygon points="30,40 18,20 46,28" fill="#475569"/>
        <polygon points="90,40 102,20 74,28" fill="#475569"/>
        <circle cx="60" cy="65" r="44" fill="#64748b"/>
        <ellipse cx="60" cy="78" rx="22" ry="24" fill="#f1f5f9"/>
        <!-- Big Eyes -->
        <circle cx="44" cy="52" r="14" fill="#fef08a"/>
        <circle cx="76" cy="52" r="14" fill="#fef08a"/>
        <circle cx="44" cy="52" r="6" fill="#0f172a"/>
        <circle cx="76" cy="52" r="6" fill="#0f172a"/>
        <circle cx="46" cy="50" r="2" fill="#ffffff"/>
        <circle cx="78" cy="50" r="2" fill="#ffffff"/>
        <polygon points="60,64 54,56 66,56" fill="#ea580c"/>
      </svg>
    `)
  },
  {
    id: 'astronaut',
    name: '探索宇航员',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Helmet Out -->
        <circle cx="60" cy="60" r="48" fill="#e2e8f0"/>
        <!-- Ears -->
        <rect x="8" y="52" width="6" height="18" rx="3" fill="#94a3b8"/>
        <rect x="106" y="52" width="6" height="18" rx="3" fill="#94a3b8"/>
        <!-- Visor -->
        <rect x="25" y="32" width="70" height="52" rx="24" fill="#1e1b4b"/>
        <!-- Visor gradient reflection -->
        <ellipse cx="60" cy="58" rx="30" ry="22" fill="#312e81"/>
        <path d="M 38,40 Q 60,36 78,44" fill="none" stroke="#60a5fa" stroke-width="4" stroke-linecap="round" opacity="0.8"/>
        <circle cx="46" cy="62" r="3" fill="#38bdf8"/>
        <circle cx="72" cy="55" r="2" fill="#c084fc"/>
      </svg>
    `)
  },
  {
    id: 'robot',
    name: '赛博机器人',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Antenna -->
        <line x1="60" y1="12" x2="60" y2="28" stroke="#06b6d4" stroke-width="4"/>
        <circle cx="60" cy="12" r="6" fill="#06b6d4"/>
        <!-- Ears -->
        <rect x="12" y="50" width="8" height="24" rx="4" fill="#475569"/>
        <rect x="100" y="50" width="8" height="24" rx="4" fill="#475569"/>
        <!-- Head -->
        <rect x="20" y="28" width="80" height="70" rx="16" fill="#334155"/>
        <!-- Screen -->
        <rect x="28" y="38" width="64" height="40" rx="8" fill="#0f172a"/>
        <!-- Cyan Eyes -->
        <rect x="36" y="48" width="14" height="12" rx="4" fill="#22d3ee"/>
        <rect x="70" y="48" width="14" height="12" rx="4" fill="#22d3ee"/>
        <!-- Mouth -->
        <line x1="42" y1="68" x2="78" y2="68" stroke="#22d3ee" stroke-width="3" stroke-linecap="round" stroke-dasharray="4,4"/>
      </svg>
    `)
  },
  {
    id: 'geek',
    name: '极客少年',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Hair back -->
        <circle cx="60" cy="62" r="46" fill="#1e293b"/>
        <!-- Face -->
        <ellipse cx="60" cy="68" rx="34" ry="36" fill="#fed7aa"/>
        <!-- Hair front -->
        <path d="M 26,45 C 35,28 75,25 94,45 C 80,40 70,35 60,44 C 50,35 38,40 26,45 Z" fill="#0f172a"/>
        <!-- Glasses -->
        <rect x="34" y="54" width="22" height="16" rx="4" fill="none" stroke="#4f46e5" stroke-width="3"/>
        <rect x="64" y="54" width="22" height="16" rx="4" fill="none" stroke="#4f46e5" stroke-width="3"/>
        <line x1="56" y1="62" x2="64" y2="62" stroke="#4f46e5" stroke-width="3"/>
        <circle cx="45" cy="62" r="3" fill="#1e293b"/>
        <circle cx="75" cy="62" r="3" fill="#1e293b"/>
        <circle cx="46" cy="60" r="1" fill="#ffffff"/>
        <circle cx="76" cy="60" r="1" fill="#ffffff"/>
        <!-- Smile -->
        <path d="M 52,78 Q 60,84 68,78" fill="none" stroke="#c2410c" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `)
  },
  {
    id: 'girl',
    name: '元气少女',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Twintails -->
        <ellipse cx="22" cy="70" rx="14" ry="24" fill="#7c2d12"/>
        <ellipse cx="98" cy="70" rx="14" ry="24" fill="#7c2d12"/>
        <!-- Hair back -->
        <circle cx="60" cy="60" r="44" fill="#7c2d12"/>
        <!-- Face -->
        <ellipse cx="60" cy="68" rx="34" ry="34" fill="#ffedd5"/>
        <!-- Bangs -->
        <path d="M 28,52 Q 60,30 92,52 Q 80,42 60,44 Q 40,42 28,52 Z" fill="#9a3412"/>
        <!-- Eyes -->
        <circle cx="45" cy="64" r="5" fill="#431407"/>
        <circle cx="75" cy="64" r="5" fill="#431407"/>
        <circle cx="46.5" cy="62" r="2" fill="#ffffff"/>
        <circle cx="76.5" cy="62" r="2" fill="#ffffff"/>
        <!-- Blush -->
        <ellipse cx="36" cy="72" rx="5" ry="3" fill="#f43f5e" opacity="0.4"/>
        <ellipse cx="84" cy="72" rx="5" ry="3" fill="#f43f5e" opacity="0.4"/>
        <path d="M 54,76 Q 60,82 66,76" fill="none" stroke="#e11d48" stroke-width="2" stroke-linecap="round"/>
        <!-- Bow -->
        <polygon points="26,45 16,36 16,54" fill="#ec4899"/>
        <polygon points="34,45 44,36 44,54" fill="#ec4899"/>
        <circle cx="30" cy="45" r="4" fill="#f43f5e"/>
      </svg>
    `)
  },
  {
    id: 'music_boy',
    name: '电音潮人',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <!-- Headphone Band -->
        <path d="M 24,65 A 40,40 0 0,1 96,65" fill="none" stroke="#ec4899" stroke-width="6"/>
        <!-- Face -->
        <circle cx="60" cy="66" r="38" fill="#ffedd5"/>
        <!-- Hair Cap -->
        <path d="M 30,55 Q 60,30 90,55" fill="#0284c7"/>
        <polygon points="90,55 110,50 96,62" fill="#0369a1"/>
        <circle cx="46" cy="66" r="4" fill="#0f172a"/>
        <circle cx="74" cy="66" r="4" fill="#0f172a"/>
        <!-- Headphones Cans -->
        <rect x="14" y="55" width="14" height="26" rx="6" fill="#f43f5e"/>
        <rect x="92" y="55" width="14" height="26" rx="6" fill="#f43f5e"/>
        <path d="M 52,78 Q 60,84 68,78" fill="none" stroke="#0f172a" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    `)
  },
  {
    id: 'wizard',
    name: '魔法学徒',
    category: '潮流先锋',
    url: svgToDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <circle cx="60" cy="70" r="38" fill="#fde68a"/>
        <!-- Wizard Hat -->
        <polygon points="60,6 20,48 100,48" fill="#6366f1"/>
        <ellipse cx="60" cy="48" rx="46" ry="9" fill="#4338ca"/>
        <!-- Hat Star -->
        <polygon points="60,26 62,32 68,32 63,36 65,42 60,38 55,42 57,36 52,32 58,32" fill="#fbbf24"/>
        <circle cx="46" cy="68" r="4.5" fill="#1e1b4b"/>
        <circle cx="74" cy="68" r="4.5" fill="#1e1b4b"/>
        <circle cx="48" cy="66" r="1.5" fill="#ffffff"/>
        <circle cx="76" cy="66" r="1.5" fill="#ffffff"/>
        <!-- Magic Sparkle -->
        <polygon points="96,28 98,33 103,33 99,36 100,41 96,38 92,41 93,36 89,33 94,33" fill="#38bdf8"/>
        <path d="M 54,80 Q 60,86 66,80" fill="none" stroke="#7c2d12" stroke-width="2" stroke-linecap="round"/>
      </svg>
    `)
  }
]
