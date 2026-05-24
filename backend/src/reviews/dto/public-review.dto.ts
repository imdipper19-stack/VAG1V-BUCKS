/**
 * Shape of a single review as returned by the public-facing API.
 *
 * Defined as a TypeScript type (not a class) because it is purely a
 * response contract — there is no inbound validation surface.
 *
 * Privacy invariant (Requirements 7.1–7.3):
 *   the public endpoint MUST NOT include `orderId`, IP address,
 *   user-agent, moderator id, or any other order/buyer identifier.
 *   Only the five fields below are safe to expose to anonymous
 *   callers.
 *
 *   - `id`         stable handle for client-side carousel keys
 *   - `nickname`   buyer-supplied display name
 *   - `stars`      integer 0..5
 *   - `text`       buyer-supplied review body (plain text)
 *   - `createdAt`  ISO-8601 string for locale-aware formatting on
 *                  the client (frontend uses
 *                  `new Date(createdAt)` + Intl.DateTimeFormat).
 */
export interface PublicReviewDto {
  id: string;
  nickname: string;
  stars: number;
  text: string;
  createdAt: string;
}
