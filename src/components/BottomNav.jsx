const IconHome = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h3v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6h3a1 1 0 0 0 1-1V9.5" />
  </svg>
);

const IconMovs = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const IconAgenda = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
  </svg>
);

const IconMas = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

const TABS = [
  { id: 'inicio',      label: 'Inicio', Icon: IconHome },
  { id: 'movimientos', label: 'Movs',   Icon: IconMovs },
  { id: 'agenda',      label: 'Agenda', Icon: IconAgenda },
  { id: 'mas',         label: 'Más',    Icon: IconMas },
];

export default function BottomNav({ active, onChange, tabs = TABS }) {
  const mid = Math.ceil(tabs.length / 2);

  const Item = ({ tab }) => (
    <button
      className={`mp-nav__item ${active === tab.id ? 'is-active' : ''}`}
      onClick={() => onChange(tab.id)}
      aria-current={active === tab.id ? 'page' : undefined}
    >
      <span className="mp-nav__icon" aria-hidden="true"><tab.Icon /></span>
      <span className="mp-nav__label">{tab.label}</span>
    </button>
  );

  return (
    <nav className="mp-nav" aria-label="Navegación principal">
      <div className="mp-nav__side">
        {tabs.slice(0, mid).map((t) => <Item key={t.id} tab={t} />)}
      </div>
      <div className="mp-nav__gap" aria-hidden="true" />
      <div className="mp-nav__side">
        {tabs.slice(mid).map((t) => <Item key={t.id} tab={t} />)}
      </div>
    </nav>
  );
}
