// plotly.js-dist-min is already minified: served as a plain file and loaded
// with a <script> tag, it stays out of the bundler, which spent most of the
// build re-parsing and re-minifying its 4.6 MB.
import plotlyUrl from 'plotly.js-dist-min/plotly.min.js?url';

// Set once loadPlotly() resolves (live binding for importers).
export let Plotly = null;

let loading = null;

export const loadPlotly = () => {
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = plotlyUrl;
    script.onload = () => { Plotly = window.Plotly; resolve(Plotly); };
    script.onerror = () => { script.remove(); loading = null; reject(new Error(`could not load ${plotlyUrl}`)); };
    document.head.appendChild(script);
  });
  return loading;
};
