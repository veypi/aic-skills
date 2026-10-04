package cua

import "math"

// coordinatePair accepts the typed parser's representation and JSON-decoded
// arrays from fields(). Reject malformed points instead of dropping the locator.
func coordinatePair(value any) (point [2]float64, ok bool) {
	switch v := value.(type) {
	case []float64:
		if len(v) != 2 {
			return point, false
		}
		copy(point[:], v)
	case []any:
		if len(v) != 2 {
			return point, false
		}
		for i := range point {
			point[i], ok = v[i].(float64)
			if !ok {
				return point, false
			}
		}
	default:
		return point, false
	}
	return point, finite(point[0]) && finite(point[1])
}

func finite(n float64) bool { return !math.IsNaN(n) && !math.IsInf(n, 0) }
