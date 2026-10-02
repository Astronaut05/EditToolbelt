/**
 * `@etb/core/api`: the public API's schemas and its OpenAPI document
 * (docs/06), shared by the web server, `/developers` and `@etb/api-client`.
 */
export * from './schemas';
export { ENDPOINTS, openApiDocument, problemsOf, statusesOf, type Endpoint } from './openapi';
