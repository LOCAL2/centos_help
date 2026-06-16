import { categories } from '../data/commands';
import { CommandCard } from './CommandCard';
import { useSearch } from '../hooks/useSearch';

interface CommandLibraryProps {
  searchQuery?: string;
  selectedCategory?: string | null;
}

export function CommandLibrary({ searchQuery = '', selectedCategory: propCategory = null }: CommandLibraryProps) {
  const { results, selectCategory, selectedCategory } = useSearch(propCategory);

  // Sync from props
  const activeCategory = propCategory !== undefined ? propCategory : selectedCategory;
  const searchResults = searchQuery
    ? results.filter(r =>
        r.command.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.command.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.command.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : results;

  const displayResults = activeCategory
    ? searchResults.filter(r => r.command.category === activeCategory)
    : searchResults;

  return (
    <div className="command-library">
      <div className="library-header">
        <h1 className="library-title">
          {activeCategory
            ? categories.find(c => c.id === activeCategory)?.name ?? 'Commands'
            : 'All Commands'}
        </h1>
        <span className="library-count">{displayResults.length} commands</span>
      </div>

      <div className="category-filter-bar">
        <button
          className={`cat-filter-btn${!activeCategory ? ' cat-filter-btn--active' : ''}`}
          onClick={() => selectCategory(null)}
        >
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`cat-filter-btn${activeCategory === cat.id ? ' cat-filter-btn--active' : ''}`}
            onClick={() => selectCategory(cat.id)}
            style={{ '--cat-color': cat.color } as React.CSSProperties}
          >
            <span>{cat.icon}</span>
            <span className="cat-filter-name">{cat.name}</span>
          </button>
        ))}
      </div>

      {displayResults.length === 0 ? (
        <div className="library-empty">
          <p>No commands found{searchQuery ? ` for "${searchQuery}"` : ''}.</p>
          <button className="btn-secondary" onClick={() => selectCategory(null)}>Clear filter</button>
        </div>
      ) : (
        <div className="commands-grid">
          {displayResults.map(r => (
            <CommandCard key={r.command.id} command={r.command} />
          ))}
        </div>
      )}
    </div>
  );
}
