import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

// One stylesheet for both halves of the system. The office and the library are
// the same library, and a person who learns one screen should recognise the
// other.
import '../../ui/src/styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
