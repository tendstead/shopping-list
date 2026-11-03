package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func raw(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func apply(t *testing.T, s *State, op Operation) {
	t.Helper()
	op.TripID = s.TripID
	if e := s.Apply(op, time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)); e != nil {
		t.Fatal(e)
	}
}
func add(t *testing.T, s *State, id, name string, reusable, counter, tags bool) {
	t.Helper()
	apply(t, s, Operation{Kind: "item_add", ItemID: id, Name: name, Reusable: reusable, Counter: counter, ShowTags: tags, Tags: []string{"A", "B"}})
}
func set(t *testing.T, s *State, id, field string, base, value any) {
	t.Helper()
	apply(t, s, Operation{Kind: "trip_set", ItemID: id, Field: field, Base: raw(base), Value: raw(value)})
}
func TestChecklistControls(t *testing.T) {
	s := New()
	add(t, &s, "milk", "  Milk   bottles ", true, false, true)
	if s.Items[0].Name != "Milk bottles" || s.Items[0].Needed {
		t.Fatal(s.Items[0])
	}
	set(t, &s, "milk", "needed", false, true)
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "milk", Field: "counter", Base: raw(false), Value: raw(true)})
	if s.Items[0].Count != 1 {
		t.Fatal("enabling counter must initialize needed count")
	}
	set(t, &s, "milk", "count", 1, 3)
	set(t, &s, "milk", "selectedTags", []string{}, []string{"A", "B"})
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "milk", Field: "showTags", Base: raw(true), Value: raw(false)})
	if len(s.Items[0].SelectedTags) != 0 {
		t.Fatal("hidden tags must clear")
	}
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "milk", Field: "counter", Base: raw(true), Value: raw(false)})
	if !s.Items[0].Needed || s.Items[0].Count != 0 {
		t.Fatal("disabling counter preserves needed")
	}
}
func TestDuplicateAndOneTime(t *testing.T) {
	s := New()
	add(t, &s, "a", "Milk bottles", true, false, false)
	e := s.Apply(Operation{Kind: "item_add", TripID: s.TripID, ItemID: "b", Name: " milk  BOTTLES ", Reusable: true}, time.Now())
	if e == nil || e.Code != "duplicate" || e.ItemID != "a" {
		t.Fatal(e)
	}
	add(t, &s, "c", "Cake", false, true, false)
	if !s.Items[1].Needed || s.Items[1].Count != 1 {
		t.Fatal("one time starts needed")
	}
	apply(t, &s, Operation{Kind: "item_delete", ItemID: "c", Base: raw(s.Items[1])})
	if len(s.Items) != 1 {
		t.Fatal("delete one time")
	}
	set(t, &s, "a", "needed", false, true)
	apply(t, &s, Operation{Kind: "item_delete", ItemID: "a", Base: raw(s.Items[0])})
	if len(s.Items) != 1 || s.Items[0].Reusable || !s.Items[0].Needed {
		t.Fatal("retain needed as one time")
	}
}
func TestMergingAndConflict(t *testing.T) {
	s := New()
	add(t, &s, "a", "Milk", true, false, true)
	add(t, &s, "b", "Bread", true, false, false)
	set(t, &s, "a", "needed", false, true)
	set(t, &s, "b", "needed", false, true)
	set(t, &s, "a", "needed", false, true) // identical changes converge
	set(t, &s, "a", "selectedTags", []string{}, []string{"A"})
	e := s.Apply(Operation{Kind: "trip_set", TripID: s.TripID, ItemID: "a", Field: "selectedTags", Base: raw([]string{}), Value: raw([]string{"B"})}, time.Now())
	if e == nil || e.Code != "conflict" {
		t.Fatal(e)
	}
	if string(e.Current) != "[\"A\"]" {
		t.Fatal(string(e.Current))
	}
}
func TestCompletionAndHistory(t *testing.T) {
	s := New()
	add(t, &s, "a", "Milk", true, true, true)
	add(t, &s, "b", "Bread", false, false, false)
	add(t, &s, "c", "Cake", false, true, false)
	set(t, &s, "a", "count", 0, 2)
	set(t, &s, "a", "selectedTags", []string{}, []string{"A"})
	set(t, &s, "a", "purchased", false, true)
	set(t, &s, "b", "purchased", false, true)
	old := s.TripID
	rev := s.Revision
	_, e := s.Finish(rev-1, time.Now())
	if e == nil {
		t.Fatal("stale completion accepted")
	}
	h, e := s.Finish(rev, time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC))
	if e != nil {
		t.Fatal(e)
	}
	if len(h.Items) != 3 || h.Items[0].Name != "Milk" || h.Items[0].Count != 2 || !h.Items[0].Purchased || !h.Items[2].CarriedOver {
		t.Fatal(h)
	}
	if len(s.Items) != 2 || s.Items[0].Needed || s.Items[0].Count != 0 || len(s.Items[0].SelectedTags) != 0 || !s.Items[1].Needed || s.Items[1].Count != 1 {
		t.Fatal(s.Items)
	}
	if s.TripID == old {
		t.Fatal("trip not rotated")
	}
	e = s.Apply(Operation{Kind: "trip_set", TripID: old, ItemID: "a", Field: "count", Base: raw(0), Value: raw(3)}, time.Now())
	if e == nil || e.Code != "late_trip" {
		t.Fatal(e)
	}
	apply(t, &s, Operation{Kind: "item_edit", ItemID: "a", Field: "name", Base: raw("Milk"), Value: raw("Oat milk")})
	if h.Items[0].Name != "Milk" {
		t.Fatal("history mutated")
	}
}
func TestLayoutsAndValidation(t *testing.T) {
	s := New()
	add(t, &s, "a", "Milk", true, false, false)
	add(t, &s, "b", "Bread", true, false, false)
	l := s.Layouts[0]
	if len(l.Order) != 2 {
		t.Fatal(l)
	}
	apply(t, &s, Operation{Kind: "layout_order", LayoutID: l.ID, Base: raw(l.Order), Value: raw([]string{"b", "a"})})
	e := s.Apply(Operation{Kind: "layout_order", TripID: s.TripID, LayoutID: l.ID, Base: raw(l.Order), Value: raw([]string{"a", "b"})}, time.Now())
	if e == nil || e.Code != "conflict" {
		t.Fatal(e)
	}
	for _, op := range []Operation{{Kind: "trip_set", ItemID: "a", Field: "count", Base: raw(0), Value: raw(-1)}, {Kind: "item_edit", ItemID: "a", Field: "tags", Base: raw([]string{"A", "B"}), Value: raw([]string{"ABCD"})}, {Kind: "layout_delete", LayoutID: "missing"}} {
		op.TripID = s.TripID
		if e := s.Apply(op, time.Now()); e == nil {
			t.Fatal("invalid accepted", op)
		}
	}
}

func TestNullValuesAreRejectedWithoutChangingState(t *testing.T) {
	s := New()
	add(t, &s, "a", "Milk", true, true, true)
	before := s.Revision
	for _, field := range []string{"count", "selectedTags"} {
		op := Operation{Kind: "trip_set", TripID: s.TripID, ItemID: "a", Field: field, Base: raw(0), Value: raw(nil)}
		if e := s.Apply(op, time.Now()); e == nil {
			t.Fatalf("null %s accepted", field)
		}
	}
	if s.Revision != before {
		t.Fatal("invalid write changed revision")
	}
}
