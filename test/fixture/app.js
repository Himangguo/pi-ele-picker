import './app.css';

/**
 * The fixture app the picker is exercised against.
 *
 * `?omit=gone` removes `#gone` on every load. That is how the "the element the
 * draft pointed at is no longer in the page" case is reproduced without route
 * interception: the reload keeps the query string, so the element disappears
 * again before the picker's restore pass looks for it — the same end state an HMR
 * update that unmounts a node leaves behind.
 */
if (new URLSearchParams(location.search).get('omit') === 'gone') {
  document.querySelector('#gone')?.remove();
}
