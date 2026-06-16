import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Terminal, LayoutTemplate, BookOpen, Sun, Moon, ChevronRight } from 'lucide-react';

interface HeaderProps {
  onMenuToggle: () => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  breadcrumb?: string;
}

export function Header({ onMenuToggle, theme, onThemeToggle, breadcrumb }: HeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const getViewLabel = () => {
    if (location.pathname.startsWith('/terminal')) return 'Terminal';
    if (location.pathname.startsWith('/split')) return 'Split View';
    return 'Library';
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-menu-btn" onClick={onMenuToggle} aria-label="Toggle menu">
          <Menu size={20} />
        </button>
        <nav className="header-breadcrumb" aria-label="Breadcrumb">
          <Link to="/" className="breadcrumb-item">Home</Link>
          {breadcrumb && (
            <>
              <ChevronRight size={14} className="breadcrumb-sep" />
              <span className="breadcrumb-item breadcrumb-item--current">{breadcrumb}</span>
            </>
          )}
        </nav>
      </div>

      <div className="header-center">
        <div className="header-view-switcher">
          <Link
            to="/"
            className={`view-btn${!location.pathname.startsWith('/terminal') && !location.pathname.startsWith('/split') ? ' view-btn--active' : ''}`}
            title="Library"
          >
            <BookOpen size={15} />
            <span>Library</span>
          </Link>
          <Link
            to="/split"
            className={`view-btn${location.pathname.startsWith('/split') ? ' view-btn--active' : ''}`}
            title="Split View"
          >
            <LayoutTemplate size={15} />
            <span>Split</span>
          </Link>
          <Link
            to="/terminal"
            className={`view-btn${location.pathname === '/terminal' ? ' view-btn--active' : ''}`}
            title="Terminal"
          >
            <Terminal size={15} />
            <span>Terminal</span>
          </Link>
        </div>
      </div>

      <div className="header-right">
        <button
          className="header-icon-btn"
          onClick={onThemeToggle}
          aria-label="Toggle theme"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="header-terminal-btn"
          onClick={() => navigate('/terminal')}
          aria-label="Open Terminal"
        >
          <Terminal size={15} />
          <span>Open Terminal</span>
        </button>
      </div>

      <div className="header-mobile-view-label">
        {getViewLabel()}
      </div>
    </header>
  );
}
