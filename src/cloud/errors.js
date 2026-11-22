export class AuthRequiredError extends Error {
  constructor(message = 'Accesso Microsoft scaduto: accedi di nuovo') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export class OfflineError extends Error {
  constructor() {
    super('Nessuna connessione');
    this.name = 'OfflineError';
  }
}

export class GraphError extends Error {
  constructor(status, code, message) {
    super(message || `Errore ${status}`);
    this.name = 'GraphError';
    this.status = status;
    this.code = code;
  }
}

/** The file name is taken by a file with a different image: the user decides. */
export class NameTakenError extends Error {
  constructor(existing) {
    super('Su OneDrive c’è già uno scontrino con stessa data, ora ed esercente, ma un’immagine diversa');
    this.name = 'NameTakenError';
    this.existing = existing; // { id, name, webUrl, blob }
  }
}

/** The signed-in account cannot see (404) or write (403) the folder. */
export const isAccessDenied = (e) => e instanceof GraphError && (e.status === 403 || e.status === 404);

/**
 * User-facing (Italian) explanation of an upload/Graph failure. `account` (the
 * signed-in address) makes permission errors actionable: the usual cause is a
 * folder shared with a different address than the one used to sign in.
 */
export function describeError(e, { account } = {}) {
  if (e instanceof GraphError) {
    if (e.status === 403) {
      return account
        ? `Permesso negato: chiedi al proprietario di condividere la cartella con ${account} con permesso di modifica`
        : 'Permesso negato: la cartella deve essere condivisa con te con permesso di modifica';
    }
    if (e.status === 404) return 'Cartella non trovata: è stata spostata o non è più condivisa?';
    if (e.status === 507) return 'Spazio OneDrive esaurito';
    return `${e.message} (${e.status})`;
  }
  return e?.message || String(e);
}
