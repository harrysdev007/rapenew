import {Buffer} from 'buffer';
import React from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/manrope';
import './style.css';
globalThis.Buffer=Buffer;
const {default:Root}=await import('./Root');
createRoot(document.getElementById('root')!).render(<React.StrictMode><Root/></React.StrictMode>);
