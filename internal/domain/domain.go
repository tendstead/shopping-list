// Package domain implements the shared checklist, trip and layout rules.
package domain

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"time"
)

type Item struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Reusable     bool     `json:"reusable"`
	Counter      bool     `json:"counter"`
	ShowTags     bool     `json:"showTags"`
	Tags         []string `json:"tags"`
	Needed       bool     `json:"needed"`
	Count        int      `json:"count"`
	SelectedTags []string `json:"selectedTags"`
	Purchased    bool     `json:"purchased"`
}
type Layout struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Order []string `json:"order"`
}
type State struct {
	TripID   string   `json:"tripId"`
	Revision int64    `json:"revision"`
	Items    []Item   `json:"items"`
	Layouts  []Layout `json:"layouts"`
}
type SnapshotItem struct {
	Name         string   `json:"name"`
	Count        int      `json:"count"`
	Counter      bool     `json:"counter"`
	SelectedTags []string `json:"selectedTags"`
	Purchased    bool     `json:"purchased"`
	CarriedOver  bool     `json:"carriedOver"`
}
type History struct {
	ID          string         `json:"id"`
	CompletedAt time.Time      `json:"completedAt"`
	Items       []SnapshotItem `json:"items"`
}
type Operation struct {
	ID       string          `json:"id"`
	TripID   string          `json:"tripId"`
	Kind     string          `json:"kind"`
	ItemID   string          `json:"itemId,omitempty"`
	LayoutID string          `json:"layoutId,omitempty"`
	Name     string          `json:"name,omitempty"`
	Reusable bool            `json:"reusable,omitempty"`
	Counter  bool            `json:"counter,omitempty"`
	ShowTags bool            `json:"showTags,omitempty"`
	Tags     []string        `json:"tags,omitempty"`
	Field    string          `json:"field,omitempty"`
	Base     json.RawMessage `json:"base,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	Revision int64           `json:"revision,omitempty"`
}
type Problem struct {
	Code    string          `json:"code"`
	Message string          `json:"message"`
	ItemID  string          `json:"itemId,omitempty"`
	Current json.RawMessage `json:"current,omitempty"`
}

func (p *Problem) Error() string        { return p.Code + ": " + p.Message }
func problem(code, msg string) *Problem { return &Problem{Code: code, Message: msg} }
func ID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func New() State {
	s := State{TripID: ID(), Items: []Item{}, Layouts: []Layout{}}
	for _, name := range []string{"Aldi", "Walmart", "Home · A", "Home · B"} {
		s.Layouts = append(s.Layouts, Layout{ID: ID(), Name: name, Order: []string{}})
	}
	return s
}
func normalize(s string) string { return strings.Join(strings.Fields(s), " ") }

var validID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)
var validTag = regexp.MustCompile(`^[a-zA-Z0-9]{1,3}$`)

func tags(v []string) ([]string, *Problem) {
	out := []string{}
	for _, s := range v {
		s = strings.TrimSpace(s)
		if !validTag.MatchString(s) {
			return nil, problem("invalid", "Tags must contain one to three letters or digits")
		}
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	slices.Sort(out)
	return out, nil
}
func encoded(v any) json.RawMessage { b, _ := json.Marshal(v); return b }
func equal(a, b json.RawMessage) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return string(encoded(x)) == string(encoded(y))
}
func compare(current any, base, value json.RawMessage) *Problem {
	c := encoded(current)
	if equal(c, value) || equal(c, base) {
		return nil
	}
	return &Problem{Code: "conflict", Message: "Choose which value to keep", Current: c}
}
func (s *State) duplicate(name, except string) *Problem {
	for _, i := range s.Items {
		if i.ID != except && strings.EqualFold(normalize(i.Name), name) {
			return &Problem{Code: "duplicate", Message: "An item with this name already exists", ItemID: i.ID}
		}
	}
	return nil
}

// Apply never partially changes a state when validation or conflict detection fails.
func (s *State) Apply(op Operation, _ time.Time) *Problem {
	if op.TripID != s.TripID {
		return problem("late_trip", "This trip has finished. Review before applying to the new trip")
	}
	b := encoded(s)
	var next State
	_ = json.Unmarshal(b, &next)
	if p := next.apply(op); p != nil {
		return p
	}
	next.Revision++
	*s = next
	return nil
}
func (s *State) apply(op Operation) *Problem {
	if (op.Kind == "trip_set" || op.Kind == "item_edit" || op.Kind == "layout_order") && (!json.Valid(op.Value) || bytes.Equal(bytes.TrimSpace(op.Value), []byte("null"))) {
		return problem("invalid", "Supply a non-null field value")
	}
	switch op.Kind {
	case "item_add":
		name := normalize(op.Name)
		if name == "" || len(name) > 240 || !validID.MatchString(op.ItemID) {
			return problem("invalid", "Supply an item id and name")
		}
		if p := s.duplicate(name, ""); p != nil {
			return p
		}
		for _, i := range s.Items {
			if i.ID == op.ItemID {
				return problem("conflict", "Item id already exists")
			}
		}
		ts, p := tags(op.Tags)
		if p != nil {
			return p
		}
		i := Item{ID: op.ItemID, Name: name, Reusable: op.Reusable, Counter: op.Counter, ShowTags: op.ShowTags, Tags: ts, Needed: !op.Reusable, SelectedTags: []string{}}
		if i.Counter && i.Needed {
			i.Count = 1
		}
		s.Items = append(s.Items, i)
		for n := range s.Layouts {
			s.Layouts[n].Order = append(s.Layouts[n].Order, i.ID)
		}
		return nil
	case "item_edit", "item_delete", "trip_set":
		n := slices.IndexFunc(s.Items, func(i Item) bool { return i.ID == op.ItemID })
		if n < 0 {
			return problem("missing", "Item was removed")
		}
		i := &s.Items[n]
		if op.Kind == "item_delete" {
			if p := compare(*i, op.Base, nil); p != nil {
				return p
			}
			if i.Reusable && i.Needed {
				i.Reusable = false
				return nil
			}
			s.Items = slices.Delete(s.Items, n, n+1)
			for k := range s.Layouts {
				s.Layouts[k].Order = slices.DeleteFunc(s.Layouts[k].Order, func(id string) bool { return id == op.ItemID })
			}
			return nil
		}
		if op.Kind == "item_edit" {
			switch op.Field {
			case "name":
				var v string
				if json.Unmarshal(op.Value, &v) != nil {
					return problem("invalid", "Invalid name")
				}
				v = normalize(v)
				if v == "" || len(v) > 240 {
					return problem("invalid", "Supply a name")
				}
				if p := compare(i.Name, op.Base, encoded(v)); p != nil {
					return p
				}
				if p := s.duplicate(v, i.ID); p != nil {
					return p
				}
				i.Name = v
			case "counter", "showTags":
				var v bool
				if json.Unmarshal(op.Value, &v) != nil {
					return problem("invalid", "Expected a boolean")
				}
				if op.Field == "counter" {
					if p := compare(i.Counter, op.Base, op.Value); p != nil {
						return p
					}
					i.Counter = v
					if v && i.Needed && i.Count == 0 {
						i.Count = 1
					}
					if !v {
						i.Count = 0
					}
				} else {
					if p := compare(i.ShowTags, op.Base, op.Value); p != nil {
						return p
					}
					i.ShowTags = v
					if !v {
						i.SelectedTags = []string{}
					}
				}
			case "tags":
				var v []string
				if json.Unmarshal(op.Value, &v) != nil {
					return problem("invalid", "Expected tag labels")
				}
				v, p := tags(v)
				if p != nil {
					return p
				}
				if p := compare(i.Tags, op.Base, encoded(v)); p != nil {
					return p
				}
				i.Tags = v
				i.SelectedTags = slices.DeleteFunc(i.SelectedTags, func(t string) bool { return !slices.Contains(v, t) })
			default:
				return problem("invalid", "Unknown checklist field")
			}
			return nil
		}
		switch op.Field {
		case "needed":
			var v bool
			if json.Unmarshal(op.Value, &v) != nil || i.Counter {
				return problem("invalid_controls", "Use the counter for this item")
			}
			if p := compare(i.Needed, op.Base, op.Value); p != nil {
				return p
			}
			i.Needed = v
			if !v {
				i.Purchased = false
			}
		case "count":
			var v int
			if json.Unmarshal(op.Value, &v) != nil || v < 0 || v > 1000000 || !i.Counter {
				return problem("invalid_controls", "Count must be a non-negative integer on a counter item")
			}
			if p := compare(i.Count, op.Base, op.Value); p != nil {
				return p
			}
			i.Count = v
			i.Needed = v > 0
			if !i.Needed {
				i.Purchased = false
			}
		case "selectedTags":
			var v []string
			if json.Unmarshal(op.Value, &v) != nil || !i.ShowTags {
				return problem("invalid_controls", "Tags are hidden for this item")
			}
			v, p := tags(v)
			if p != nil {
				return p
			}
			for _, t := range v {
				if !slices.Contains(i.Tags, t) {
					return problem("invalid_controls", "Tag label was removed")
				}
			}
			if p := compare(i.SelectedTags, op.Base, encoded(v)); p != nil {
				return p
			}
			i.SelectedTags = v
		case "purchased":
			var v bool
			if json.Unmarshal(op.Value, &v) != nil || !i.Needed {
				return problem("invalid_controls", "Only needed items can be purchased")
			}
			if p := compare(i.Purchased, op.Base, op.Value); p != nil {
				return p
			}
			i.Purchased = v
		default:
			return problem("invalid", "Unknown trip field")
		}
		return nil
	case "layout_add":
		name := normalize(op.Name)
		if name == "" || len(name) > 240 || !validID.MatchString(op.LayoutID) {
			return problem("invalid", "Supply layout id and name")
		}
		for _, l := range s.Layouts {
			if l.ID == op.LayoutID || strings.EqualFold(l.Name, name) {
				return problem("duplicate_layout", "Layout already exists")
			}
		}
		order := []string{}
		for _, i := range s.Items {
			order = append(order, i.ID)
		}
		s.Layouts = append(s.Layouts, Layout{ID: op.LayoutID, Name: name, Order: order})
		return nil
	case "layout_rename", "layout_delete", "layout_order":
		n := slices.IndexFunc(s.Layouts, func(l Layout) bool { return l.ID == op.LayoutID })
		if n < 0 {
			return problem("missing", "Layout was removed")
		}
		l := &s.Layouts[n]
		switch op.Kind {
		case "layout_delete":
			if len(s.Layouts) == 1 {
				return problem("invalid", "Keep at least one layout")
			}
			if p := compare(*l, op.Base, nil); p != nil {
				return p
			}
			s.Layouts = slices.Delete(s.Layouts, n, n+1)
		case "layout_rename":
			v := normalize(op.Name)
			if v == "" || len(v) > 240 {
				return problem("invalid", "Supply a layout name")
			}
			if p := compare(l.Name, op.Base, encoded(v)); p != nil {
				return p
			}
			for _, other := range s.Layouts {
				if other.ID != l.ID && strings.EqualFold(other.Name, v) {
					return problem("duplicate_layout", "Layout already exists")
				}
			}
			l.Name = v
		case "layout_order":
			var v []string
			if json.Unmarshal(op.Value, &v) != nil || len(v) != len(s.Items) {
				return problem("conflict", "Layout items have changed")
			}
			ids := map[string]bool{}
			for _, i := range s.Items {
				ids[i.ID] = true
			}
			for _, id := range v {
				if !ids[id] {
					return problem("invalid", "Order must contain every item exactly once")
				}
				delete(ids, id)
			}
			if p := compare(l.Order, op.Base, op.Value); p != nil {
				return p
			}
			l.Order = v
		}
		return nil
	default:
		return problem("invalid", "Unknown operation")
	}
}
func (s *State) Finish(revision int64, now time.Time) (History, *Problem) {
	if revision != s.Revision {
		return History{}, problem("stale_revision", "Trip changed. Synchronize and review before finishing")
	}
	h := History{ID: s.TripID, CompletedAt: now.UTC(), Items: []SnapshotItem{}}
	keep := []Item{}
	removed := map[string]bool{}
	for _, i := range s.Items {
		if i.Needed {
			h.Items = append(h.Items, SnapshotItem{Name: i.Name, Count: i.Count, Counter: i.Counter, SelectedTags: slices.Clone(i.SelectedTags), Purchased: i.Purchased, CarriedOver: !i.Purchased})
		}
		if i.Purchased {
			if !i.Reusable {
				removed[i.ID] = true
				continue
			}
			i.Needed = false
			i.Count = 0
			i.SelectedTags = []string{}
			i.Purchased = false
		}
		keep = append(keep, i)
	}
	s.Items = keep
	for k := range s.Layouts {
		s.Layouts[k].Order = slices.DeleteFunc(s.Layouts[k].Order, func(id string) bool { return removed[id] })
	}
	s.TripID = ID()
	s.Revision++
	return h, nil
}
