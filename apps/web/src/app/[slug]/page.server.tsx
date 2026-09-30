/**
 * The server build: re-rendered with the tool status in the database, at most
 * 30 s old. A path not generated at build renders on demand (and answers 404
 * while its tool is off), so a tool switched off and on again comes back.
 */
export { default, generateMetadata, generateStaticParams } from './view';

export const revalidate = 30;
