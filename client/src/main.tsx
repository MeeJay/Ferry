import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-center"
        toastOptions={{
          className: '!bg-ink !text-bg !font-bold !rounded-xl !text-sm !shadow-none',
          success: { iconTheme: { primary: 'rgb(var(--accent))', secondary: 'rgb(var(--ink))' } },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
