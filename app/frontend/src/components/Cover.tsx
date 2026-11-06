import type { CSSProperties } from 'react';
import type { Book } from '../api';

/** A generated cover: the book's accent colour, its title set large, a few quiet lines. */
export function Cover({ book, size = 'md' }: { book: Pick<Book, 'title' | 'edition' | 'authors' | 'accent'>; size?: 'md' | 'lg' }) {
  const style = { '--accent': book.accent } as CSSProperties;
  return (
    <div className={`cover cover-${size}`} style={style} aria-hidden>
      <div className="cover-lines">
        <i /><i /><i />
      </div>
      <div className="cover-title">{book.title}</div>
      <div className="cover-foot">
        {book.edition && <span>{book.edition}</span>}
        {book.authors.length > 0 && <span>{book.authors.join(' · ')}</span>}
      </div>
    </div>
  );
}
