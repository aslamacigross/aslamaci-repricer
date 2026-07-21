DELETE FROM jobs WHERE name IN('listing-health-scan','content-quality-scan');
DROP TABLE IF EXISTS listing_health_assessments;
DROP TABLE IF EXISTS listing_content_snapshots;
DROP TABLE IF EXISTS ai_content_drafts;
