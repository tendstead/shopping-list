import { error } from '@sveltejs/kit';

export function load({ params }: { params: { section?: string } }) {
  if (
    params.section &&
    params.section !== 'history' &&
    params.section !== 'edit'
  ) {
    error(404, 'Page not found');
  }
}
