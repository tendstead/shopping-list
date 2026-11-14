package domain

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestItemCategory(t *testing.T) {
	for _, reusable := range []bool{false, true} {
		s := New()
		var op Operation
		_ = json.Unmarshal([]byte(`{"kind":"item_add","itemId":"cumin","name":"Cumin","category":"spices"}`), &op)
		op.Reusable = reusable
		apply(t, &s, op)
		if !strings.Contains(string(raw(s.Items[0])), `"category":"spices"`) {
			t.Fatal("category missing", s.Items[0])
		}
		apply(t, &s, Operation{Kind: "item_edit", ItemID: "cumin", Field: "category", Base: raw("spices"), Value: raw("")})
		if strings.Contains(string(raw(s.Items[0])), `"category"`) {
			t.Fatal("empty category must be omitted")
		}
		for _, v := range []any{"invented", 42, nil} {
			before := string(raw(s))
			p := s.Apply(Operation{TripID: s.TripID, Kind: "item_edit", ItemID: "cumin", Field: "category", Base: raw(""), Value: raw(v)}, time.Now())
			if p == nil || p.Code != "invalid" || string(raw(s)) != before {
				t.Fatalf("invalid category changed state: %v", p)
			}
		}
	}
}

func TestCategoryMergeAndLegacyOperations(t *testing.T) {
	s := New()
	add(t, &s, "a", "Cumin", false, false, false)
	old := raw(s.Items[0])
	set(t, &s, "a", "purchased", false, true)
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "a", Field: "category", Base: raw(""), Value: raw("spices")})
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "a", Field: "category", Base: raw(""), Value: raw("spices")})
	before := string(raw(s))
	p := s.Apply(Operation{TripID: s.TripID, Kind: "item_edit", ItemID: "a", Field: "category", Base: raw(""), Value: raw("")}, time.Now())
	if p == nil || p.Code != "conflict" || string(raw(s)) != before {
		t.Fatal("stale edit accepted", p)
	}
	if p = s.Apply(Operation{TripID: s.TripID, Kind: "item_delete", ItemID: "a", Base: old}, time.Now()); p == nil {
		t.Fatal("category deletion conflict missing")
	}
	legacy := New()
	add(t, &legacy, "b", "Bread", false, false, false)
	b := raw(legacy.Items[0])
	var decoded State
	if err := json.Unmarshal(raw(legacy), &decoded); err != nil {
		t.Fatal(err)
	}
	apply(t, &decoded, Operation{Kind: "item_delete", ItemID: "b", Base: b})
	if len(decoded.Items) != 0 {
		t.Fatal("old delete did not replay")
	}
	if strings.Contains(string(raw(Operation{Kind: "item_add", ItemID: "old", Name: "Old"})), `"category"`) {
		t.Fatal("legacy operation serialization changed")
	}
}

func TestCategorySurvivesFinishWithoutChangingHistory(t *testing.T) {
	s := New()
	for _, id := range []string{"reusable", "one-time", "bought"} {
		apply(t, &s, Operation{Kind: "item_add", ItemID: id, Name: id, Category: "spices", Reusable: id == "reusable"})
	}
	set(t, &s, "reusable", "needed", false, true)
	set(t, &s, "bought", "purchased", false, true)
	h, p := s.Finish(s.Revision, time.Now())
	if p != nil {
		t.Fatal(p)
	}
	before := string(raw(h))
	if len(s.Items) != 2 {
		t.Fatal("purchased one-time not removed")
	}
	for _, i := range s.Items {
		if i.Category != "spices" || !i.Needed {
			t.Fatal("unfinished category lost", i)
		}
	}
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "reusable", Field: "category", Base: raw("spices"), Value: raw("")})
	if string(raw(h)) != before {
		t.Fatal("history changed")
	}
	oldTrip := Operation{TripID: "finished-trip", Kind: "item_edit", ItemID: "reusable", Field: "category", Base: raw(""), Value: raw("spices")}
	if p := s.Apply(oldTrip, time.Now()); p == nil || p.Code != "late_trip" {
		t.Fatal(p)
	}
}
