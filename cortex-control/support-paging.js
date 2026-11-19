export const SUPPORT_PAGE_SIZE = 25;

export function supportPageBounds(total, requestedPage) {
  const count = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(count / SUPPORT_PAGE_SIZE));
  const requested = Number.isSafeInteger(requestedPage) ? requestedPage : 0;
  const page = Math.max(0, Math.min(pages - 1, requested));
  return {
    page,
    pages,
    offset: page * SUPPORT_PAGE_SIZE,
    end: Math.min(count, (page + 1) * SUPPORT_PAGE_SIZE)
  };
}
