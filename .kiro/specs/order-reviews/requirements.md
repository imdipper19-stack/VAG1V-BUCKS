# Requirements Document

## Introduction

The Order Reviews feature allows buyers to leave a public review (nickname, star rating, free-form text) for an order after V-Bucks have been successfully delivered. Submitted reviews go to a moderation queue. After an administrator approves a review, the review is rendered on the public landing page inside an auto-rotating "live" carousel positioned near the bottom of the page (a natural trust-building section above the legal/footer block). When no approved reviews exist, the carousel shows a single placeholder card with the exact copy «Здесь мог отображаться ваш отзыв» that invites the next buyer to be the first.

The feature is anonymous (no buyer accounts). A review is bound to a specific Order (one review per order). The customer's email and order identifier are never revealed publicly. The Reviews_Service enforces server-side validation, anti-spam rules, and a delivery-window after which new submissions are no longer accepted. The Admin_Reviews_Module exposes the moderation queue with approve and reject actions, and every moderation action is written to the existing AdminActivityLog audit trail.

This document defines requirements for: the public landing carousel, the buyer-facing submission flow on the order timeline page, the admin moderation experience, the data model and lifecycle, validation, privacy, and anti-spam protections. Implementation details (table layout, exact API shape, UI component code) are intentionally deferred to the design document.

## Glossary

- **Reviews_Service**: The backend NestJS service responsible for creating, validating, persisting, and querying Review records, and for enforcing eligibility, moderation lifecycle, and rate-limit rules.
- **Reviews_API**: The public HTTP surface exposed by the Reviews_Service. Includes a public endpoint that returns approved reviews for the landing carousel, a buyer endpoint that creates a new review for a specific Order, and admin endpoints for moderation.
- **Admin_Reviews_Module**: The administrator-facing UI section that lists, approves, and rejects pending reviews. Mounted inside the existing Admin Dashboard and protected by the existing AdminAuthGuard.
- **Reviews_Carousel**: The public landing-page component that renders approved reviews as an auto-rotating, swipeable, hover-pausable carousel positioned near the bottom of the landing page above the legal/footer block.
- **Reviews_Empty_State**: The single placeholder card rendered by the Reviews_Carousel when zero approved reviews exist. Contains the exact copy «Здесь мог отображаться ваш отзыв» and a short call-to-action inviting the next buyer to be the first to leave a review.
- **Review**: A persisted record consisting of an Order foreign key, a nickname, a star rating, a body text, a moderation status, a created-at timestamp, an approved-at timestamp (nullable), a moderated-by admin reference (nullable), and an optional rejection reason.
- **Order**: An existing order entity owned by the OrdersModule. Used as the foreign key target of a Review and as the source of the eligibility check (status and delivery timestamp).
- **Order_Status_Completed**: The terminal Order state representing successful V-Bucks delivery. Only orders in this state are eligible to receive a review.
- **Delivery_Window**: A bounded period of 30 calendar days starting from the moment the Order entered Order_Status_Completed. Reviews may only be submitted for an Order while the current time is inside the Delivery_Window.
- **Review_Status**: The moderation lifecycle state of a Review. One of `pending`, `approved`, `rejected`. `pending` is the initial state on submission. `approved` makes the review visible publicly. `rejected` keeps the review hidden but retained for audit. Un-publishing of an approved review is out of scope for the first version.
- **Review_Submission_Form**: The buyer-facing form rendered on the order timeline page after the Order reaches Order_Status_Completed. Collects nickname, star rating, and review text and submits a single Review tied to the current orderId.
- **Nickname**: A free-text display name supplied by the buyer for a Review. Server-trimmed plain text, length 2 to 64 inclusive after trim, no HTML rendering.
- **Star_Rating**: An integer score on the inclusive range 0 to 5 supplied by the buyer for a Review.
- **Review_Text**: A free-text body supplied by the buyer for a Review. Server-trimmed plain text, length 10 to 1000 inclusive after trim, no HTML rendering.
- **AdminAuthGuard**: The existing NestJS guard owned by the AdminModule that authorises administrator-only HTTP endpoints.
- **AdminActivityLog**: The existing audit-log service owned by the AdminModule that persists administrator actions for after-the-fact review.
- **Order_Timeline_Page**: The existing buyer-facing page at `/order/[orderId]/timeline` that displays the live status of a single Order. The Review_Submission_Form is rendered on this page after the Order reaches Order_Status_Completed.
- **Landing_Page**: The existing public marketing page at `/` (the project root route) on which the Reviews_Carousel is mounted near the bottom, above the legal/footer block.
- **Moderation_Queue**: The administrator-facing list of reviews in `pending` Review_Status, ordered by createdAt descending, rendered by the Admin_Reviews_Module.

## Requirements

### Requirement 1: Public landing carousel of approved reviews

**User Story:** As a prospective buyer visiting the landing page, I want to see real reviews from previous buyers near the bottom of the page, so that I can build trust in the store before placing an order.

#### Acceptance Criteria

1. THE Reviews_Carousel SHALL be rendered on the Landing_Page near the bottom of the page, above the legal/footer block.
2. THE Reviews_Carousel SHALL be visible on viewport widths from 320 pixels up to and including 1920 pixels.
3. WHEN the Landing_Page is loaded, THE Reviews_API SHALL return only Reviews whose Review_Status is `approved`.
4. WHEN the Reviews_API returns one or more approved Reviews, THE Reviews_Carousel SHALL render each Review showing the Nickname, the Star_Rating, the Review_Text, and the createdAt date formatted as a human-readable date in the page locale.
5. WHEN the length of a Review_Text exceeds 240 characters, THE Reviews_Carousel SHALL render a truncated preview followed by an expand control labelled «…читать дальше» that reveals the full Review_Text on activation.
6. WHILE the Reviews_Carousel contains two or more approved Reviews and the pointer is not hovering the carousel and the carousel has keyboard focus on no interactive child, THE Reviews_Carousel SHALL advance to the next Review every 6 seconds.
7. WHILE the pointer is hovering the Reviews_Carousel, THE Reviews_Carousel SHALL pause auto-rotation.
8. THE Reviews_Carousel SHALL allow the user to advance to the next or previous Review manually using on-screen controls and using horizontal swipe gestures on touch devices.
9. THE Reviews_Carousel SHALL never display the email address of the buyer associated with a Review.
10. THE Reviews_Carousel SHALL never display the orderId or any other Order identifier associated with a Review.

### Requirement 2: Empty state of the public carousel

**User Story:** As a prospective buyer visiting the landing page when no reviews have been approved yet, I want to see a friendly placeholder, so that the page does not feel empty and I am invited to be the first reviewer.

#### Acceptance Criteria

1. WHEN the Reviews_API returns zero approved Reviews, THE Reviews_Carousel SHALL render exactly one Reviews_Empty_State card.
2. THE Reviews_Empty_State SHALL display the exact text «Здесь мог отображаться ваш отзыв».
3. THE Reviews_Empty_State SHALL include a short call-to-action inviting the next buyer to be the first to leave a review after their order completes.
4. WHILE the Reviews_Empty_State is shown, THE Reviews_Carousel SHALL NOT auto-rotate.

### Requirement 3: Eligibility to submit a review

**User Story:** As a buyer who has just received V-Bucks, I want the option to leave a review on the order page, so that I can share my experience while it is fresh.

#### Acceptance Criteria

1. WHILE the Order associated with the Order_Timeline_Page is in Order_Status_Completed and the current time is inside the Delivery_Window for that Order and no Review exists for that Order, THE Order_Timeline_Page SHALL display a primary call-to-action labelled «Оставить отзыв» that opens the Review_Submission_Form.
2. WHILE the Order associated with the Order_Timeline_Page is not in Order_Status_Completed, THE Order_Timeline_Page SHALL NOT display the «Оставить отзыв» call-to-action.
3. WHILE a Review already exists for the Order associated with the Order_Timeline_Page, THE Order_Timeline_Page SHALL display the message «Спасибо, вы уже оставили отзыв» in place of the «Оставить отзыв» call-to-action.
4. WHILE the current time is outside the Delivery_Window of the Order associated with the Order_Timeline_Page and no Review exists for that Order, THE Order_Timeline_Page SHALL hide the «Оставить отзыв» call-to-action.
5. IF the Reviews_API receives a submission for an Order that is not in Order_Status_Completed, THEN THE Reviews_Service SHALL reject the submission with an error indicating that the Order is not eligible for a review.
6. IF the Reviews_API receives a submission for an Order whose current time is outside the Delivery_Window, THEN THE Reviews_Service SHALL reject the submission with an error indicating that the review window has expired.
7. IF the Reviews_API receives a submission for an Order that already has a Review, THEN THE Reviews_Service SHALL reject the submission with an error indicating that a review already exists for that Order.

### Requirement 4: Review submission form on the order timeline page

**User Story:** As a buyer leaving a review, I want a clear form with nickname, stars, and a comment, so that I can submit my feedback in one step.

#### Acceptance Criteria

1. THE Review_Submission_Form SHALL collect a Nickname, a Star_Rating, and a Review_Text in a single submission.
2. THE Review_Submission_Form SHALL render the Star_Rating input as 6 selectable stars representing integer values 0 through 5 inclusive.
3. THE Review_Submission_Form SHALL mark Nickname, Star_Rating, and Review_Text as required.
4. WHEN the buyer submits the Review_Submission_Form with valid values, THE Reviews_Service SHALL create a new Review tied to the current Order with Review_Status `pending`.
5. WHEN the Reviews_Service successfully creates a Review, THE Review_Submission_Form SHALL display a confirmation message indicating that the review has been sent for moderation.
6. THE Review_Submission_Form SHALL validate Nickname, Star_Rating, and Review_Text on the client before sending the submission to the Reviews_API.
7. THE Reviews_Service SHALL validate Nickname, Star_Rating, and Review_Text on the server independently of any client-side validation.
8. IF the buyer attempts to submit the Review_Submission_Form with an invalid value, THEN THE Review_Submission_Form SHALL display a field-level error message and SHALL NOT send the submission to the Reviews_API.

### Requirement 5: Field validation rules

**User Story:** As the store operator, I want strict validation of review fields, so that public reviews stay clean, readable, and free of injected markup.

#### Acceptance Criteria

1. THE Reviews_Service SHALL trim leading and trailing whitespace from the Nickname before validation and persistence.
2. THE Reviews_Service SHALL accept a Nickname whose length after trimming is between 2 and 64 characters inclusive.
3. IF the Nickname after trimming is shorter than 2 characters or longer than 64 characters, THEN THE Reviews_Service SHALL reject the submission with a field-level validation error on Nickname.
4. THE Reviews_Service SHALL persist the Nickname as plain text and SHALL NOT render HTML contained in the Nickname.
5. THE Reviews_Service SHALL accept a Star_Rating that is an integer on the inclusive range 0 to 5.
6. IF the Star_Rating is not an integer or is outside the inclusive range 0 to 5, THEN THE Reviews_Service SHALL reject the submission with a field-level validation error on Star_Rating.
7. THE Reviews_Service SHALL trim leading and trailing whitespace from the Review_Text before validation and persistence.
8. THE Reviews_Service SHALL accept a Review_Text whose length after trimming is between 10 and 1000 characters inclusive.
9. IF the Review_Text after trimming is shorter than 10 characters or longer than 1000 characters, THEN THE Reviews_Service SHALL reject the submission with a field-level validation error on Review_Text.
10. THE Reviews_Service SHALL persist the Review_Text as plain text and SHALL NOT render HTML contained in the Review_Text.

### Requirement 6: Data model and one-review-per-order constraint

**User Story:** As the store operator, I want each order to have at most one review, so that the carousel reflects one voice per purchase.

#### Acceptance Criteria

1. THE Reviews_Service SHALL persist each Review with a foreign key reference to a single Order.
2. THE Reviews_Service SHALL enforce a database-level uniqueness constraint that prevents more than one Review from existing for the same Order.
3. IF the database rejects a Review insert due to the uniqueness constraint on Order, THEN THE Reviews_Service SHALL respond with an error indicating that a review already exists for that Order.
4. THE Reviews_Service SHALL persist for each Review a Review_Status field whose value is one of `pending`, `approved`, or `rejected`.
5. THE Reviews_Service SHALL set Review_Status to `pending` on creation.
6. THE Reviews_Service SHALL persist for each Review the createdAt timestamp at the time of creation.
7. WHEN an administrator approves a Review, THE Reviews_Service SHALL persist the approvedAt timestamp at the time of approval.
8. WHEN an administrator approves or rejects a Review, THE Reviews_Service SHALL persist a reference to the administrator who performed the action.
9. WHERE an administrator provides a rejection reason on rejection, THE Reviews_Service SHALL persist the rejection reason as plain text on the Review.

### Requirement 7: Privacy of buyer information

**User Story:** As a buyer leaving a review, I want my email and order identifier to stay private, so that nothing personal is exposed publicly.

#### Acceptance Criteria

1. THE Reviews_API public endpoint SHALL include only Nickname, Star_Rating, Review_Text, and createdAt in each Review returned for the Reviews_Carousel.
2. THE Reviews_API public endpoint SHALL NOT include the buyer email address in any Review returned to a non-administrator caller.
3. THE Reviews_API public endpoint SHALL NOT include the orderId or any other Order identifier in any Review returned to a non-administrator caller.
4. THE Reviews_Carousel SHALL render only the fields exposed by the public Reviews_API endpoint and SHALL NOT request, derive, or display the buyer email or orderId.

### Requirement 8: Anti-spam protections

**User Story:** As the store operator, I want basic anti-spam protections on the review submission endpoint, so that leaked order links cannot be used to flood the moderation queue.

#### Acceptance Criteria

1. THE Reviews_Service SHALL accept review submissions only for Orders in Order_Status_Completed.
2. THE Reviews_Service SHALL accept review submissions only while the current time is inside the Delivery_Window of the target Order.
3. THE Delivery_Window SHALL start at the moment the Order entered Order_Status_Completed and SHALL end 30 calendar days later.
4. IF the same client IP address submits more than 5 review submissions inside any 60-minute window, THEN THE Reviews_Service SHALL reject further submissions from that IP address with an error indicating that the rate limit has been exceeded until the window has elapsed.
5. WHERE the administrator configures a different per-IP rate-limit threshold or window, THE Reviews_Service SHALL apply the configured values instead of the defaults.

### Requirement 9: Admin moderation queue

**User Story:** As an administrator, I want a moderation queue showing all pending reviews, so that I can decide which reviews appear on the public carousel.

#### Acceptance Criteria

1. THE Admin_Reviews_Module SHALL be mounted inside the existing Admin Dashboard at a dedicated route.
2. THE Admin_Reviews_Module SHALL be accessible only to callers authorised by the AdminAuthGuard.
3. WHEN an administrator opens the Admin_Reviews_Module, THE Admin_Reviews_Module SHALL display the Moderation_Queue containing all Reviews whose Review_Status is `pending`, ordered by createdAt descending.
4. THE Admin_Reviews_Module SHALL display for each pending Review the Nickname, the Star_Rating, the Review_Text, the createdAt timestamp, and the orderId.
5. THE Admin_Reviews_Module SHALL provide for each pending Review an «Одобрить» action and an «Отклонить» action.
6. THE Admin_Reviews_Module SHALL allow the administrator to enter an optional plain-text rejection reason when invoking the «Отклонить» action.

### Requirement 10: Approve and reject moderation actions

**User Story:** As an administrator, I want approve and reject actions to update the review status and write to the audit log, so that decisions are traceable.

#### Acceptance Criteria

1. WHEN an administrator invokes the «Одобрить» action on a Review, THE Reviews_Service SHALL set the Review_Status of that Review to `approved`.
2. WHEN an administrator invokes the «Одобрить» action on a Review, THE Reviews_Service SHALL set the approvedAt timestamp on that Review to the current time.
3. WHEN an administrator invokes the «Одобрить» action on a Review, THE Reviews_Service SHALL append an entry to the AdminActivityLog identifying the administrator, the action `review.approve`, and the Review identifier.
4. WHEN the Review_Status of a Review transitions to `approved`, THE Reviews_API public endpoint SHALL include that Review in subsequent responses to the Reviews_Carousel.
5. WHEN an administrator invokes the «Отклонить» action on a Review, THE Reviews_Service SHALL set the Review_Status of that Review to `rejected`.
6. WHEN an administrator invokes the «Отклонить» action on a Review, THE Reviews_Service SHALL persist the rejection reason if provided.
7. WHEN an administrator invokes the «Отклонить» action on a Review, THE Reviews_Service SHALL append an entry to the AdminActivityLog identifying the administrator, the action `review.reject`, the Review identifier, and the rejection reason if provided.
8. WHILE the Review_Status of a Review is `rejected`, THE Reviews_API public endpoint SHALL NOT include that Review in any response to a non-administrator caller.
9. THE Reviews_Service SHALL retain Reviews whose Review_Status is `rejected` for audit purposes and SHALL NOT delete them as part of the moderation actions.
10. IF an administrator invokes the «Одобрить» or «Отклонить» action on a Review whose Review_Status is not `pending`, THEN THE Reviews_Service SHALL reject the action with an error indicating that the Review is no longer pending.
