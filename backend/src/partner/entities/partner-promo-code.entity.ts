import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Maps the `partner_promo_codes` table created in migration
 * `1735000000000-AddPartnerTables`.
 *
 * Notes:
 *   - `partner_id` is kept as a plain UUID column (no @ManyToOne relation)
 *     to avoid circular imports between `Partner` and `PartnerPromoCode`
 *     entities (per design.md §1.1 and the entity-style guide).
 *   - There is no `@UpdateDateColumn` — the underlying table only has
 *     `created_at` (the row is rotated by setting `is_current=false` and
 *     inserting a new row, see PromoCodeService.regenerate).
 *   - DB-level uniqueness on `code` is enforced by the migration's
 *     `UQ_partner_promo_codes_code` constraint; declaring `unique: true`
 *     on the column keeps the ORM metadata consistent.
 */
@Entity('partner_promo_codes')
export class PartnerPromoCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'partner_id', type: 'uuid' })
  @Index('IDX_partner_promo_codes_partner_id')
  partnerId: string;

  @Column({ type: 'varchar', length: 16, unique: true })
  code: string;

  @Column({ name: 'is_current', type: 'boolean', default: true })
  @Index('IDX_partner_promo_codes_is_current')
  isCurrent: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
