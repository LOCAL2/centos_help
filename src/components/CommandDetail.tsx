import { useNavigate, useParams } from 'react-router-dom';
import { Copy, Check, ArrowLeft, Lightbulb, Star, Link2, Terminal } from 'lucide-react';
import { useState } from 'react';
import { commands, categories } from '../data/commands';

interface CopyBtnProps { text: string; }
function CopyBtn({ text }: CopyBtnProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="copy-btn" onClick={handleCopy} aria-label="Copy to clipboard" title="Copy">
      {copied ? <Check size={14} color="#4ade80" /> : <Copy size={14} />}
    </button>
  );
}

interface CommandDetailProps {
  commandId?: string;
  embedded?: boolean;
}

export function CommandDetail({ commandId: propId, embedded = false }: CommandDetailProps) {
  const { id: paramId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const id = propId ?? paramId;
  const command = commands.find(c => c.id === id);
  const category = command ? categories.find(c => c.id === command.category) : null;

  if (!command) {
    return (
      <div className="command-detail-empty">
        <p>Command not found.</p>
        {!embedded && <button className="btn-back" onClick={() => navigate('/')}><ArrowLeft size={16} /> Back</button>}
      </div>
    );
  }

  return (
    <div className={`command-detail${embedded ? ' command-detail--embedded' : ''}`}>
      {!embedded && (
        <div className="command-detail-topbar">
          <button className="btn-back" onClick={() => navigate(-1)}><ArrowLeft size={16} /> Back</button>
          <button className="btn-terminal" onClick={() => navigate(`/split/${command.id}`)}>
            <Terminal size={14} /> Try in Terminal
          </button>
        </div>
      )}

      <div className="command-detail-hero">
        <code className="command-detail-name">{command.name}</code>
        {category && (
          <span className="command-detail-badge" style={{ backgroundColor: category.color + '22', color: category.color }}>
            {category.icon} {category.name}
          </span>
        )}
      </div>

      <p className="command-detail-description">{command.longDescription}</p>

      <section className="command-detail-section">
        <h2 className="section-title">Syntax</h2>
        <div className="syntax-block">
          <code>{command.syntax}</code>
          <CopyBtn text={command.syntax} />
        </div>
      </section>

      {command.options.length > 0 && (
        <section className="command-detail-section">
          <h2 className="section-title">Options</h2>
          <div className="options-table">
            {command.options.map(opt => (
              <div key={opt.flag} className="options-row">
                <code className="options-flag">{opt.flag}</code>
                <span className="options-desc">{opt.description}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {command.examples.length > 0 && (
        <section className="command-detail-section">
          <h2 className="section-title">Examples</h2>
          <div className="examples-list">
            {command.examples.map((ex, i) => (
              <div key={i} className="example-item">
                <div className="example-header">
                  <span className="example-desc">{ex.description}</span>
                  <CopyBtn text={ex.command} />
                </div>
                <code className="example-command">$ {ex.command}</code>
                {ex.output && <pre className="example-output">{ex.output}</pre>}
              </div>
            ))}
          </div>
        </section>
      )}

      {command.tips.length > 0 && (
        <section className="command-detail-section">
          <h2 className="section-title"><Lightbulb size={16} className="section-icon" /> Tips</h2>
          <ul className="tips-list">
            {command.tips.map((tip, i) => <li key={i} className="tip-item">{tip}</li>)}
          </ul>
        </section>
      )}

      {command.bestPractices.length > 0 && (
        <section className="command-detail-section">
          <h2 className="section-title"><Star size={16} className="section-icon" /> Best Practices</h2>
          <ul className="tips-list tips-list--green">
            {command.bestPractices.map((bp, i) => <li key={i} className="tip-item">{bp}</li>)}
          </ul>
        </section>
      )}

      {command.relatedCommands.length > 0 && (
        <section className="command-detail-section">
          <h2 className="section-title"><Link2 size={16} className="section-icon" /> Related Commands</h2>
          <div className="related-commands">
            {command.relatedCommands.map(rel => {
              const relCmd = commands.find(c => c.name === rel || c.id === rel);
              return relCmd ? (
                <button key={rel} className="related-cmd-btn" onClick={() => navigate(`/command/${relCmd.id}`)}>
                  <code>{rel}</code>
                </button>
              ) : (
                <span key={rel} className="related-cmd-btn related-cmd-btn--inactive"><code>{rel}</code></span>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
