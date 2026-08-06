INSERT OR IGNORE INTO activity_documentation_fields
  (id, activity_id, field_type, label, help_text, unit, required, minimum_items, maximum_items, minimum_value, maximum_value, options_json, sort_order)
VALUES
  ('adf-t1-reference-comment', 'act-t1-020', 'text', 'Beskriv referenspunkten',
   'Ange placering, hur punkten är markerad och vad den kan återfinnas mot.',
   NULL, 0, NULL, NULL, NULL, NULL, NULL, 10);

INSERT OR IGNORE INTO activity_documentation_profiles
  (activity_id, documentation_profile_id)
VALUES
  ('act-t1-020', 'dp-work'),
  ('act-t1-020', 'dp-relations');
