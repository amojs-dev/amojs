/**
 * Pure route matching — plain node, no DOM, no Navigation API.
 * (Browser behavior — interception, races, forms, scroll — is verified in a
 * real browser; happy-dom has no Navigation API, so it CANNOT stand in here.)
 */
import { test, expect } from 'vitest';
import { compileRoutes, matchRoute, stripBase } from '../src/match.js';
import { redirect, link } from '../src/index.js';

const routes = compileRoutes({
  '/': 'home',
  '/users': 'users',
  '/users/:id': 'user',
  '/users/:id/posts/:postId': 'post',
  '/file.txt': 'file',
  '*': 'missing',
});

test('static routes match exactly', () => {
  expect(matchRoute(routes, '/')).toEqual({ load: 'home', params: {} });
  expect(matchRoute(routes, '/users')).toEqual({ load: 'users', params: {} });
});

test(':params are extracted and percent-decoded', () => {
  expect(matchRoute(routes, '/users/42')).toEqual({ load: 'user', params: { id: '42' } });
  expect(matchRoute(routes, '/users/a%20b')).toEqual({ load: 'user', params: { id: 'a b' } });
});

test('multiple params in one pattern', () => {
  expect(matchRoute(routes, '/users/7/posts/9')).toEqual({
    load: 'post',
    params: { id: '7', postId: '9' },
  });
});

test('a param never spans a slash', () => {
  expect(matchRoute(routes, '/users/1/2')).toEqual({ load: 'missing', params: {} });
});

test('route characters are literal — a dot is a dot', () => {
  expect(matchRoute(routes, '/file.txt')).toEqual({ load: 'file', params: {} });
  expect(matchRoute(routes, '/fileXtxt')).toEqual({ load: 'missing', params: {} });
});

test('"*" catches everything unmatched; without it the result is null', () => {
  expect(matchRoute(routes, '/nowhere')).toEqual({ load: 'missing', params: {} });
  const bare = compileRoutes({ '/': 'home' });
  expect(matchRoute(bare, '/nowhere')).toBeNull();
});

test('stripBase: inside, exact, outside, empty', () => {
  expect(stripBase('/app/users', '/app')).toBe('/users');
  expect(stripBase('/app', '/app')).toBe('/');
  expect(stripBase('/other/users', '/app')).toBeNull();
  expect(stripBase('/apples', '/app')).toBeNull(); // prefix ≠ path segment
  expect(stripBase('/users', '')).toBe('/users');
});

test('redirect() is a plain marker object', () => {
  expect(redirect('/thanks')).toEqual({ __redirect: '/thanks' });
});

test('link() is the identity before any router sets a base', () => {
  // the base-bound behavior needs a live router (Navigation API) — that
  // part is exercised in the browser lab, like the rest of router.js
  expect(link('/users')).toBe('/users');
});
