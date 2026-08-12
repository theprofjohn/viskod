import * as fs from 'node:fs';
import * as path from 'node:path';
import { REVIEWS_DIR, VISKOD_STORAGE_DIR } from '@viskod/shared';
import { type Result, type ViskodError, createViskodError, err, ok } from '@viskod/shared';
import { VisualReviewSchema } from './schemas';
import type { VisualReview } from './types';

const REVIEW_FILE = 'review.json';
const INDEX_FILE = 'index.json';

export interface ReviewIndex {
  version: 1;
  reviews: Array<{
    reviewId: string;
    issueId: string;
    handoffId?: string;
    status: string;
    comparisonStatus?: string;
    createdAt: string;
    updatedAt: string;
  }>;
  updatedAt: string;
}

export class ReviewPersistence {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), VISKOD_STORAGE_DIR, REVIEWS_DIR);
    try {
      fs.mkdirSync(this.baseDir, { recursive: true });
    } catch {
      /* best effort */
    }
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private reviewDir(reviewId: string): string {
    return path.join(this.baseDir, reviewId);
  }

  private reviewFilePath(reviewId: string): string {
    return path.join(this.reviewDir(reviewId), REVIEW_FILE);
  }

  private indexPath(): string {
    return path.join(this.baseDir, INDEX_FILE);
  }

  async saveReview(review: VisualReview): Promise<Result<void>> {
    const parsed = VisualReviewSchema.safeParse(review);
    if (!parsed.success) {
      return err(
        this.peError(
          'SCHEMA_VALIDATION_FAILED',
          `Schema validation failed: ${parsed.error.message}`,
        ),
      );
    }

    const dir = this.reviewDir(review.reviewId);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      return err(
        this.peError(
          'PERSISTENCE_WRITE_FAILED',
          `Cannot create review directory: ${String(error)}`,
        ),
      );
    }

    const filePath = this.reviewFilePath(review.reviewId);
    const tempPath = `${filePath}.tmp`;
    try {
      const content = JSON.stringify(review, null, 2);
      fs.writeFileSync(tempPath, content, 'utf-8');
      fs.renameSync(tempPath, filePath);
      try {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
      } catch {
        /* best effort */
      }
    } catch (error) {
      return err(
        this.peError('PERSISTENCE_WRITE_FAILED', `Failed to write review file: ${String(error)}`),
      );
    }

    await this.updateIndex();
    return ok(undefined);
  }

  async loadReview(reviewId: string): Promise<Result<VisualReview>> {
    const filePath = this.reviewFilePath(reviewId);
    if (!fs.existsSync(filePath)) {
      return err(this.peError('REVIEW_NOT_FOUND', `Review '${reviewId}' not found`));
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const validated = VisualReviewSchema.safeParse(parsed);
      if (!validated.success) {
        return err(
          this.peError(
            'SCHEMA_VALIDATION_FAILED',
            `Corrupt review file: ${validated.error.message}`,
          ),
        );
      }
      return ok(validated.data as VisualReview);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return err(
          this.peError(
            'CORRUPT_REVIEW_FILE',
            `Review file is corrupt for '${reviewId}': ${String(error)}`,
          ),
        );
      }
      return err(
        this.peError('PERSISTENCE_READ_FAILED', `Failed to read review: ${String(error)}`),
      );
    }
  }

  async deleteReview(reviewId: string): Promise<Result<void>> {
    const dir = this.reviewDir(reviewId);
    if (!fs.existsSync(dir)) return ok(undefined);

    try {
      fs.rmSync(dir, { recursive: true, force: true });
      await this.updateIndex();
      return ok(undefined);
    } catch (error) {
      return err(
        this.peError('PERSISTENCE_WRITE_FAILED', `Failed to delete review: ${String(error)}`),
      );
    }
  }

  async listReviews(): Promise<Result<VisualReview[]>> {
    const reviews: VisualReview[] = [];

    if (!fs.existsSync(this.baseDir)) {
      return ok([]);
    }

    const entries = fs.readdirSync(this.baseDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '__index_cache') continue;

      const result = await this.loadReview(entry.name);
      if (result.ok) {
        reviews.push(result.value);
      }
    }

    reviews.sort((a, b) => {
      const cmp = b.updatedAt.localeCompare(a.updatedAt);
      if (cmp !== 0) return cmp;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return ok(reviews);
  }

  async rebuildIndex(): Promise<Result<void>> {
    const reviews = await this.listReviews();
    if (!reviews.ok) return reviews;

    const index: ReviewIndex = {
      version: 1,
      reviews: reviews.value.map((r) => ({
        reviewId: r.reviewId,
        issueId: r.issueId,
        handoffId: r.handoffId,
        status: r.status,
        comparisonStatus: r.comparison?.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      updatedAt: new Date().toISOString(),
    };

    const indexPath = this.indexPath();
    const tempPath = `${indexPath}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(index, null, 2), 'utf-8');
      fs.renameSync(tempPath, indexPath);
    } catch {
      // Index is optional — source of truth is review files
    }

    return ok(undefined);
  }

  private async updateIndex(): Promise<void> {
    await this.rebuildIndex().catch(() => {
      /* index is optional */
    });
  }

  reviewExists(reviewId: string): boolean {
    return fs.existsSync(this.reviewFilePath(reviewId));
  }

  private peError(code: string, message: string): ViskodError {
    return createViskodError({
      code,
      category: 'storage',
      severity: 'recoverable',
      message,
      subsystem: 'visual-review',
    });
  }
}
