// First: the catalog must be ready before any other module asks for a string
import '@/lib/i18nReact';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { SiteAccessPage } from '@/components/SiteAccess/SiteAccessPage';
import '@/styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SiteAccessPage />
  </React.StrictMode>
);
