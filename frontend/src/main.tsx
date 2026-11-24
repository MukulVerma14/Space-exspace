import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { DemoWatermark } from './components/DemoWatermark';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DemoWatermark />
  </React.StrictMode>
);
