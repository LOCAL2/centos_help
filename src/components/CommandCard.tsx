import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { Command } from '../data/commands';
import { categories } from '../data/commands';

interface CommandCardProps {
  command: Command;
}

export function CommandCard({ command }: CommandCardProps) {
  const navigate = useNavigate();
  const category = categories.find(c => c.id === command.category);

  return (
    <article
      className="command-card"
      onClick={() => navigate(`/command/${command.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate(`/command/${command.id}`); }}
      aria-label={`View details for ${command.name} command`}
      style={{ '--card-accent': category?.color ?? '#4ade80' } as React.CSSProperties}
    >
      <div className="command-card-header">
        <div className="command-card-name-row">
          <code className="command-card-name">{command.name}</code>
          <ChevronRight size={14} className="command-card-arrow" />
        </div>
        {category && (
          <span
            className="command-card-badge"
            style={{ backgroundColor: category.color + '22', color: category.color, borderColor: category.color + '44' }}
          >
            {category.icon} {category.name}
          </span>
        )}
      </div>
      <p className="command-card-desc">{command.description}</p>
      <div className="command-card-tags">
        {command.tags.slice(0, 4).map(tag => (
          <span key={tag} className="command-card-tag">{tag}</span>
        ))}
      </div>
    </article>
  );
}
