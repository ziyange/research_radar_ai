import React from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './src/App.jsx';
try {
  const html = renderToString(React.createElement(App));
  console.log(html.slice(0, 1000));
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
