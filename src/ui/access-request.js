// "Non hai accesso": shown when the signed-in account cannot open or write the
// shared folder. The request itself goes through OneDrive's own "Request
// access" page (opened from the sharing link), which notifies the owner, who
// approves it from OneDrive. Microsoft offers no API to submit it for the user.

import { getAccount } from '../cloud/auth.js';
import { signInForFolder } from '../cloud/destination.js';
import { h, icon, confirmDialog } from './dom.js';

/** Opens the access-request dialog for the shared folder `shareUrl`. */
export async function showAccessRequest({ shareUrl } = {}) {
  const account = getAccount()?.username || '';

  const body = h(
    'div.access-request',
    {},
    h(
      'p',
      {},
      'Hai fatto l’accesso come ',
      h('b', {}, account || '—'),
      ', ma la cartella non è condivisa con questo indirizzo (o non con permesso di modifica).',
    ),
    shareUrl
      ? h(
          'p',
          {},
          'Apri la cartella su OneDrive e tocca ',
          h('b', {}, 'Richiedi accesso'),
          ': OneDrive avvisa il proprietario, che approva la richiesta. Poi torna qui e tocca di nuovo ',
          h('i', {}, 'Collega cartella'),
          '.',
        )
      : h('p', {}, 'Chiedi a chi gestisce la cartella di condividerla con il tuo indirizzo.'),
    shareUrl
      ? h(
          'a.btn.primary.block',
          { href: shareUrl, target: '_blank', rel: 'noopener noreferrer', autofocus: true },
          icon('external'),
          'Richiedi accesso su OneDrive',
        )
      : null,
    h(
      'p.note',
      {},
      'Su OneDrive accedi con lo stesso indirizzo: se lì risulti con un altro account, la richiesta parte da quello. ',
      'La cartella è condivisa con un altro tuo account? ',
      h('button.link', { type: 'button', onclick: () => signInForFolder(shareUrl) }, 'Cambia account'),
    ),
  );
  await confirmDialog({ title: 'Non hai accesso a questa cartella', body, ok: 'Chiudi', cancel: null });
}
