declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module '*.css';

// d3-geo ships JS without types; @types/d3-geo isn't installed because
// d3-geo is a transitive dep (via react-globe.gl). Declare the surface
// we touch (just geoCentroid in src/splash/Globe.tsx) here.
declare module 'd3-geo' {
  export function geoCentroid(feature: object): [number, number];
}
