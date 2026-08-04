const TABS = [
  { id: 'inicio',      label: 'Inicio',      icon: '⌂' },
  { id: 'movimientos', label: 'Movimientos', icon: '☰' },
  { id: 'agenda',      label: 'Agenda',      icon: '👤' },
  { id: 'mas',         label: 'Más',         icon: '⋯' },
];

export default function BottomNav({ active, onChange, tabs = TABS }) {
  const mid = Math.ceil(tabs.length / 2);

  const Item = ({ tab }) => (
    <button
      className={`mp-nav__item ${active === tab.id ? 'is-active' : ''}`}
      onClick={() => onChange(tab.id)}
      aria-current={active === tab.id ? 'page' : undefined}
    >
      <span className="mp-nav__icon" aria-hidden="true">{tab.icon}</span>
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
