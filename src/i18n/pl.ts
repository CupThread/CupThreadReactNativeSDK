import type { CupThreadStrings } from './types';

export const plStrings: CupThreadStrings = {
  common: {
    back: 'Wstecz',
    close: 'Zamknij',
    cancel: 'Anuluj',
    confirm: 'Potwierdź',
    loading: 'Ładowanie...',
    loadingMore: 'Ładowanie kolejnych...',
    submitting: 'Wysyłanie...',
    error: 'Błąd',
    retry: 'Spróbuj ponownie',
    optional: 'opcjonalne',
    required: 'wymagane',
    anonymous: 'Anonimowy użytkownik',
    invalidEmail: 'Wprowadź prawidłowy adres e-mail.',
    justNow: 'Przed chwilą',
    minutesAgo: (m: number) => `${m} min temu`,
    hoursAgo: (h: number) => `${h} godz. temu`,
    daysAgo: (d: number) => d === 1 ? '1 dzień temu' : `${d} dni temu`,
  },
  feedbackComposer: {
    title: 'Wyślij opinię',
    titleLabel: 'Tytuł *',
    titlePlaceholder: 'Krótkie podsumowanie...',
    detailsLabel: 'Szczegóły *',
    detailsPlaceholder: 'Opisz, co się stało lub co chciałbyś poprawić...',
    nameLabel: 'Imię (opcjonalne)',
    namePlaceholder: 'np. Alex',
    emailLabel: 'E-mail do odpowiedzi (opcjonalny)',
    emailPlaceholder: 'alex@example.com',
    submitButton: 'Wyślij opinię',
    successTitle: 'Opinia wysłana',
    successMessage: 'Dziękujemy za przesłanie opinii!',
    titleMinLengthError: 'Podaj tytuł zawierający co najmniej 3 znaki.',
    descriptionMinLengthError: 'Podaj szczegóły zawierające co najmniej 5 znaków.',
    addAttachment: 'Dodaj załącznik',
    uploadingAttachment: 'Przesyłanie załącznika...',
    removeAttachment: 'Usuń',
    attachmentsHeader: 'Załączniki',
    uploadFailed: 'Nie udało się przesłać załącznika.',
    submitFailed: 'Nie udało się wysłać opinii. Spróbuj ponownie.',
  },
  featureRequests: {
    screenTitle: 'Prośby o funkcje',
    newButton: '+ Nowa',
    searchPlaceholder: 'Szukaj próśb o funkcje...',
    allVersions: 'Wszystkie wersje',
    emptyTitle: 'Nie znaleziono próśb',
    emptySubtitle: 'Zaproponuj nową funkcję jako pierwszy!',
    proposeButton: 'Zaproponuj funkcję',
    moreCommenters: '+ więcej',
    upvoted: 'Zagłosowano',
    upvote: 'Głosuj',
    loadingMore: 'Ładowanie kolejnych...',
  },
  featureRequestCompose: {
    modalTitle: 'Zaproponuj funkcję',
    titleLabel: 'Tytuł *',
    titlePlaceholder: 'Krótkie podsumowanie funkcji...',
    descriptionLabel: 'Opis *',
    descriptionPlaceholder: 'Opisz przypadek użycia i oczekiwane korzyści...',
    nameLabel: 'Imię (opcjonalne)',
    namePlaceholder: 'np. Taylor',
    submitButton: 'Wyślij propozycję',
    successTitle: 'Propozycja wysłana',
    successMessage: 'Dziękujemy! Twoja propozycja funkcji została wysłana.',
    moderationNotice: 'Twoja prośba została wysłana i zostanie opublikowana po moderacji.',
    titleMinLengthError: 'Podaj tytuł zawierający co najmniej 3 znaki.',
    descriptionMinLengthError: 'Podaj opis zawierający co najmniej 5 znaków.',
    submitFailed: 'Nie udało się przesłać propozycji. Spróbuj ponownie.',
  },
  roadmap: {
    screenTitle: 'Mapa drogowa',
    searchPlaceholder: 'Szukaj na mapie drogowej...',
    emptyColumn: 'Brak elementów na tym etapie',
    upvotesCount: (count: number) => {
      if (count === 1) return '1 głos';
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return `${count} głosy`;
      }
      return `${count} głosów`;
    },
    loadingMore: 'Ładowanie kolejnych...',
    loadMore: 'Załaduj więcej',
    showingCount: (shown: number, total: number) => `Wyświetlono ${shown} z ${total}`,
  },
  featureRequestDetail: {
    title: 'Prośba o funkcję',
    proposedBy: 'Zaproponowane przez',
    releasedIn: 'Wydane w',
    underReview: 'W trakcie przeglądu',
    discussionHeader: 'Dyskusja',
  },
  comments: {
    commentsCount: (count: number) => `Komentarze (${count})`,
    emptyComments: 'Brak komentarzy. Rozpocznij dyskusję!',
    inputPlaceholder: 'Dodaj komentarz...',
    namePlaceholder: 'Imię (opcjonalne)',
    postButton: 'Opublikuj komentarz',
    postingButton: 'Publikowanie...',
    replyButton: 'Odpowiedz',
    replyingTo: (name: string) => `Odpowiedź dla @${name}`,
    cancelReply: 'Anuluj odpowiedź',
    postFailed: 'Nie udało się opublikować komentarza',
  },
  changelog: {
    overlayTitle: 'Co nowego',
    continueButton: 'Kontynuuj',
    closeButton: 'Zamknij',
    emptyChangelog: 'Nie opublikowano jeszcze informacji o wydaniu.',
    subscribeTitle: 'Bądź na bieżąco',
    subscribeSubtitle: 'Otrzymuj e-mail za każdym razem, gdy wydamy aktualizację.',
    subscribeButton: 'Subskrybuj',
    subscribing: 'Subskrybowanie...',
    emailPlaceholder: 'Wpisz swój adres e-mail',
    subscribedSuccess: 'Subskrypcja zakończona powodzeniem!',
    unsubscribeButton: 'Anuluj subskrypcję',
    subscribeFailed: 'Nie udało się zasubskrybować dziennika zmian.',
  },
  userProfile: {
    screenTitle: 'Profil użytkownika',
    activityTitle: 'Ostatnia aktywność',
    noActivity: 'Brak ostatniej aktywności',
    loadFailed: 'Nie udało się załadować profilu',
    notFound: 'Nie znaleziono użytkownika',
    anonymous: 'Anonimowy programista',
    recentComments: 'Ostatnie komentarze',
    appsSection: (count: number) => `Aplikacje (${count})`,
    requestCount: (count: number) => {
      if (count === 1) return '1 publiczna propozycja funkcji';
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return `${count} publiczne propozycje funkcji`;
      }
      return `${count} publicznych propozycji funkcji`;
    },
    commentOn: (title: string) => `w ${title}`,
  },
};
