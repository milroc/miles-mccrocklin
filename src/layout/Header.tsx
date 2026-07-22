// Resume header: name + contact stack + social handle row.
// FontAwesome 6 brand icons. Simple Icons used to be the standard for this
// kind of resume strip but they had to drop LinkedIn after takedown
// requests, so FA6 is the lighter-touch choice that has all five marks
// (GitHub, LinkedIn, X, Instagram, Threads) with a consistent visual style.
import { useContext, type ReactNode } from 'react';
import {
  FaGithub,
  FaLinkedin,
  FaXTwitter,
  FaInstagram,
  FaThreads,
} from 'react-icons/fa6';
import { ModeContext } from '../utils/mode';
import { stripMd, urlFromMd } from '../utils/markdown';
import {
  SYL,
  SMALLCAP_PREFIX_RE,
  PRINT_URL_LABELS,
  HANDLE_TITLE,
  HANDLE_TWITTER_TITLE,
  LINKEDIN_ARIA,
  LINKEDIN_HANDLE_TEXT,
} from '../me';
import type { Contact } from '../types';
import s from './Header.module.css';

interface HeaderProps {
  contact: Contact;
}

export function Header({ contact }: HeaderProps) {
  const mode = useContext(ModeContext);
  const is1Pager = mode === '1pager';
  // contact.website may be markdown or a plain URL that already carries a
  // protocol; display the bare domain, keep the protocol on the href.
  const websiteRaw = stripMd(contact.website);
  const websiteHref =
    urlFromMd(contact.website) ||
    (websiteRaw.startsWith('http') ? websiteRaw : `https://${websiteRaw}`);
  const websiteLabel = websiteRaw.replace(/^https?:\/\//, '');
  const emailLabel = stripMd(contact.email);
  const emailHref = `mailto:${emailLabel}`;

  const addressDisplay = contact.address;

  const parts = contact.name.split(' ');
  const last = parts.pop() ?? '';
  const first = parts.join(' ');

  const syl = (str: string, sub: string, kind: 'mil' | 'roc'): ReactNode => {
    const idx = str.toLowerCase().indexOf(sub.toLowerCase());
    if (idx === -1) return str;
    const sylClass = kind === 'mil' ? s.sylMil : s.sylRoc;
    return (
      <>
        {str.slice(0, idx)}
        <span className={`${s.syl} ${sylClass}`}>{str.slice(idx, idx + sub.length)}</span>
        {str.slice(idx + sub.length)}
      </>
    );
  };

  const renderLast = (name: string): ReactNode => {
    const m = name.match(SMALLCAP_PREFIX_RE);
    if (!m) return name;
    const [, prefix, smallCap, rest] = m;
    return (
      <>
        {prefix}<sup className={s.nameSup}>{smallCap}</sup>{syl(rest!, SYL.roc, 'roc')}
      </>
    );
  };

  return (
    <header className={s.header}>
      <div>
        <h1 className={s.name}>
          {syl(first, SYL.mil, 'mil')} <span className={s.last}>{renderLast(last)}</span>
        </h1>
        <div className={s.contactStack}>
          {!is1Pager && (
            <div className={s.row}>
              <span>{addressDisplay}</span>
            </div>
          )}
          <div className={s.row}>
            {is1Pager && (
              <>
                <span>{addressDisplay}</span>
                <span className={s.sep}>·</span>
                <a href={emailHref}>{emailLabel}</a>
                <span className={s.sep}>·</span>
                <a href={websiteHref} target="_blank" rel="noreferrer">{websiteLabel}</a>
              </>
            )}
            {!is1Pager && (
              <>
                <a href={websiteHref} target="_blank" rel="noreferrer">{websiteLabel}</a>
                <span className={s.sep}>·</span>
                <a href={emailHref}>{emailLabel}</a>
                <span className={s.sep}>·</span>
                <span>{contact.phone}</span>
              </>
            )}
          </div>
          <div className={`${s.row} ${s.mono}`}>
            {is1Pager ? (
              // 1-pager / printed PDF: spell out full URLs so a recruiter
              // looking at this on paper or a downloaded PDF can copy/paste
              // them. Icons don't print well, and "milroc" alone isn't
              // enough context out of the site.
              <>
                <a href={contact.github} target="_blank" rel="noreferrer">
                  {PRINT_URL_LABELS.github}
                </a>
                <span className={s.sep}>·</span>
                <a href={contact.linkedin} target="_blank" rel="noreferrer">
                  {PRINT_URL_LABELS.linkedin}
                </a>
              </>
            ) : (
              <>
                <a
                  href={contact.github}
                  target="_blank"
                  rel="noreferrer"
                  className={s.handleLink}
                  title={HANDLE_TITLE}
                >
                  <FaGithub className={s.handleIcon} aria-hidden="true" />
                  <span className={s.handleText}>
                    <span className={`${s.syl} ${s.sylMil}`}>{SYL.mil}</span><span className={`${s.syl} ${s.sylRoc}`}>{SYL.roc}</span>
                  </span>
                </a>
                <span className={s.sep}>·</span>
                <a href={contact.linkedin} target="_blank" rel="noreferrer" aria-label={LINKEDIN_ARIA}>
                  <FaLinkedin className={s.handleIcon} aria-hidden="true" />
                  <span className={s.handleText}>{LINKEDIN_HANDLE_TEXT}</span>
                </a>
                <span className={s.sep}>·</span>
                <a
                  href={contact.twitter}
                  target="_blank"
                  rel="noreferrer"
                  className={s.handleLink}
                  title={HANDLE_TWITTER_TITLE}
                >
                  <FaXTwitter className={s.handleIcon} aria-hidden="true" />
                  <span className={s.handleText}>
                    @<span className={`${s.syl} ${s.sylMil}`}>{SYL.twitter.mil}</span><span className={`${s.syl} ${s.sylRoc}`}>{SYL.twitter.roc}</span>
                  </span>
                </a>
                {contact.instagram && (
                  <>
                    <span className={s.sep}>·</span>
                    <a
                      href={contact.instagram}
                      target="_blank"
                      rel="noreferrer"
                      className={s.handleLink}
                      title={HANDLE_TITLE}
                    >
                      <FaInstagram className={s.handleIcon} aria-hidden="true" />
                      <span className={s.handleText}>
                        <span className={`${s.syl} ${s.sylMil}`}>{SYL.mil}</span><span className={`${s.syl} ${s.sylRoc}`}>{SYL.roc}</span>
                      </span>
                    </a>
                  </>
                )}
                {contact.threads && (
                  <>
                    <span className={s.sep}>·</span>
                    <a
                      href={contact.threads}
                      target="_blank"
                      rel="noreferrer"
                      className={s.handleLink}
                      title={HANDLE_TITLE}
                    >
                      <FaThreads className={s.handleIcon} aria-hidden="true" />
                      <span className={s.handleText}>
                        <span className={`${s.syl} ${s.sylMil}`}>{SYL.mil}</span><span className={`${s.syl} ${s.sylRoc}`}>{SYL.roc}</span>
                      </span>
                    </a>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
