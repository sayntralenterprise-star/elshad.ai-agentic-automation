import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@elshad/ui-kit/tokens.css';
import { ConsoleApp } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
);
