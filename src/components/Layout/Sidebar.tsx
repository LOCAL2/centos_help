import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, BookOpen, Terminal, LayoutTemplate, X } from 'lucide-react';
import { categories, commands } from '../../data/commands';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  searchQuery: string;
  onSearch: (q: string) => void;
  selectedCategory: string | null;
  onSelectCategory: (cat: string | null) => void;
}

export function Sidebar({ isOpen, onClose, searchQuery, onSearch, selectedCategory, onSelectCategory }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const getCount = (catId: string) => commands.filter(c => c.category === catId).length;

  const navItems = [
    { to: '/', icon: <BookOpen size={16} />, label: 'Library' },
    { to: '/terminal', icon: <Terminal size={16} />, label: 'Terminal' },
    { to: '/split', icon: <LayoutTemplate size={16} />, label: 'Split View' },
  ];

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar${isOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-brand" onClick={onClose}>
            <span className="sidebar-brand-icon">🐧</span>
            <span className="sidebar-brand-text">CentOS Help</span>
          </Link>
          <button className="sidebar-close-btn" onClick={onClose} aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>

        <div className="sidebar-search">
          <Search size={14} className="sidebar-search-icon" />
          <input
            type="text"
            placeholder="Search commands..."
            value={searchQuery}
            onChange={e => { onSearch(e.target.value); navigate('/'); }}
            className="sidebar-search-input"
            aria-label="Search commands"
          />
          {searchQuery && (
            <button className="sidebar-search-clear" onClick={() => onSearch('')} aria-label="Clear search">
              <X size={12} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <Link
              key={item.to}
              to={item.to}
              className={`sidebar-nav-item${location.pathname === item.to ? ' sidebar-nav-item--active' : ''}`}
              onClick={onClose}
            >
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-section-title">Categories</div>
        <div className="sidebar-categories">
          <button
            className={`sidebar-category${!selectedCategory ? ' sidebar-category--active' : ''}`}
            onClick={() => { onSelectCategory(null); navigate('/'); onClose(); }}
          >
            <span className="sidebar-category-icon">📋</span>
            <span className="sidebar-category-name">All Commands</span>
            <span className="sidebar-category-count">{commands.length}</span>
          </button>
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`sidebar-category${selectedCategory === cat.id ? ' sidebar-category--active' : ''}`}
              onClick={() => { onSelectCategory(cat.id); navigate('/'); onClose(); }}
              style={{ '--cat-color': cat.color } as React.CSSProperties}
            >
              <span className="sidebar-category-icon">{cat.icon}</span>
              <span className="sidebar-category-name">{cat.name}</span>
              <span className="sidebar-category-count">{getCount(cat.id)}</span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
}
