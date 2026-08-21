// The one place `data/me.json` becomes a `Resume`.
//
// TypeScript reads the JSON structurally, so its closed-set fields
// (`visibility`, media `type`, media `layout`) infer as plain `string`
// and the import doesn't match the hand-written shape on its own. Four
// modules used to each perform that conversion; they now share this one,
// so there is a single boundary to check when the schema drifts.
import ME from '../data/me.json' with { type: 'json' };
import type { Resume } from './types';

export const RESUME_DATA = ME as Resume;
