-- Up Migration
-- ============================================================================
-- ENFORCE ROW LOCKING IN STOCK TRIGGER TO PREVENT CONCURRENT OVER-DRAW
-- ============================================================================
-- WHY: Under PostgreSQL READ COMMITTED isolation, two concurrent transactions
-- issuing the last stock unit simultaneously could both calculate current_stock
-- from an uncommitted snapshot, bypassing the trigger and driving inventory negative.
-- Acquiring an exclusive row lock on the parent item (FOR UPDATE) serializes
-- concurrent decrements for that SKU, guaranteeing that the second transaction
-- sees the first transaction's committed stock deduction and is reliably blocked.

CREATE OR REPLACE FUNCTION check_stock_movement_non_negative()
RETURNS TRIGGER AS $$
DECLARE
    current_stock NUMERIC(12,3);
BEGIN
    -- Only check when stock is being decremented (issue or negative adjustment)
    IF NEW.qty < 0 THEN
        -- Explicitly lock parent item row to serialize concurrent stock decrements
        PERFORM id FROM items WHERE id = NEW.item_id FOR UPDATE;

        SELECT COALESCE(SUM(qty), 0) INTO current_stock
        FROM stock_movements
        WHERE item_id = NEW.item_id;

        IF (current_stock + NEW.qty) < 0 THEN
            RAISE EXCEPTION 'Cannot issue % units of item %: current stock is %',
                ABS(NEW.qty), NEW.item_id, current_stock;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
-- ============================================================================
CREATE OR REPLACE FUNCTION check_stock_movement_non_negative()
RETURNS TRIGGER AS $$
DECLARE
    current_stock NUMERIC(12,3);
BEGIN
    IF NEW.qty < 0 THEN
        SELECT COALESCE(SUM(qty), 0) INTO current_stock
        FROM stock_movements
        WHERE item_id = NEW.item_id;

        IF (current_stock + NEW.qty) < 0 THEN
            RAISE EXCEPTION 'Cannot issue % units of item %: current stock is %',
                ABS(NEW.qty), NEW.item_id, current_stock;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
