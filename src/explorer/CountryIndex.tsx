// CountryIndex — visually hidden keyboard path to the globe. One
// button per visitable country (sourced from GlobeControls.
// visitableCountries, the same eligibility set the polygon click
// gates on). Activating a button runs the exact select flow a click
// does: camera fly + CountryPanel open. Screen readers get a named
// "Countries" navigation region; sighted mouse users never see it.

import s from './CountryIndex.module.css';

interface CountryIndexProps {
  countries: string[];
  onSelect: (name: string) => void;
}

export function CountryIndex({
  countries,
  onSelect,
}: CountryIndexProps): JSX.Element | null {
  if (countries.length === 0) return null;
  return (
    <nav className={s.root} aria-label="Countries">
      <ul className={s.list}>
        {countries.map((name) => (
          <li key={name}>
            <button type="button" onClick={() => onSelect(name)}>
              {name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
