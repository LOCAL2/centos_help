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
    if (location.pathname.startsWith('/terminal')) return 'เทอร์มินัล';
    if (location.pathname.startsWith('/split')) return 'แสดงคู่';
    return 'คลังคำสั่ง';
  };

  return (
    <header className="header">
      <div className="header-left">
        <button className="header-menu-btn" onClick={onMenuToggle} aria-label="เปิดเมนู">
          <Menu size={20} />
        </button>
        <nav className="header-breadcrumb" aria-label="Breadcrumb">
          <Link to="/" className="breadcrumb-item">หน้าหลัก</Link>
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
            title="คลังคำสั่ง"
          >
            <BookOpen size={15} />
            <span>คลังคำสั่ง</span>
          </Link>
          <Link
            to="/split"
            className={`view-btn${location.pathname.startsWith('/split') ? ' view-btn--active' : ''}`}
            title="แสดงคู่"
          >
            <LayoutTemplate size={15} />
            <span>แสดงคู่</span>
          </Link>
          <Link
            to="/terminal"
            className={`view-btn${location.pathname === '/terminal' ? ' view-btn--active' : ''}`}
            title="เทอร์มินัล"
          >
            <Terminal size={15} />
            <span>เทอร์มินัล</span>
          </Link>
        </div>
      </div>

      <div className="header-right">
        <button
          className="header-icon-btn"
          onClick={onThemeToggle}
          aria-label="เปลี่ยนธีม"
          title={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          className="header-terminal-btn"
          onClick={() => navigate('/terminal')}
          aria-label="เปิดเทอร์มินัล"
        >
          <Terminal size={15} />
          <span>เปิดเทอร์มินัล</span>
        </button>
      </div>

      <div className="header-mobile-view-label">
        {getViewLabel()}
      </div>
    </header>
  );
}
