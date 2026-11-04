import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no element with id "root"');
}

createRoot(container).render(
  <StrictMode>
    <h1>Mythos</h1>
  </StrictMode>,
);
