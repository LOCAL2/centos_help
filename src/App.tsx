import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { CommandLibrary } from './components/CommandLibrary';
import { CommandDetail } from './components/CommandDetail';
import { TerminalView } from './components/Terminal/TerminalView';
import { SplitView } from './components/SplitView';
import { useSearch } from './hooks/useSearch';
import './index.css';

function CommandDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <CommandDetail commandId={id} />;
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const { query, selectedCategory, search, selectCategory } = useSearch();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <div className="app-layout">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        searchQuery={query}
        onSearch={search}
        selectedCategory={selectedCategory}
        onSelectCategory={selectCategory}
      />
      <div className="app-main">
        <Header
          onMenuToggle={() => setSidebarOpen(o => !o)}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
        <main className="app-content">
          <Routes>
            <Route
              path="/"
              element={<CommandLibrary searchQuery={query} selectedCategory={selectedCategory} />}
            />
            <Route path="/command/:id" element={<CommandDetailRoute />} />
            <Route path="/terminal" element={<TerminalView />} />
            <Route path="/split" element={<SplitView />} />
            <Route path="/split/:id" element={<SplitView />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

export default App;
