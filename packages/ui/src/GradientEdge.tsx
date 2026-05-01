import { BaseEdge, getBezierPath, type EdgeProps } from "reactflow";
import { memo, type ReactElement } from "react";

/** Blue → purple (Turbo Flow–style) */
const GRADIENT_FROM = "#2a8af6";
const GRADIENT_TO = "#ae53ba";

const EDGE_GLOW =
  "drop-shadow(0 0 5px rgba(42, 138, 246, 0.45)) drop-shadow(0 0 4px rgba(174, 83, 186, 0.4))";

/** Gradient stroke, glow, circular tip marker */
function GradientEdgeInner(props: EdgeProps): ReactElement {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
  } = props;

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const gradId = `turbo-edge-grad-${id}`;
  const markerId = `turbo-marker-${id}`;

  return (
    <>
      <defs>
        <linearGradient
          id={gradId}
          gradientUnits="userSpaceOnUse"
          x1={sourceX}
          y1={sourceY}
          x2={targetX}
          y2={targetY}
        >
          <stop offset="0%" stopColor={GRADIENT_FROM} />
          <stop offset="100%" stopColor={GRADIENT_TO} />
        </linearGradient>
        <marker
          id={markerId}
          markerWidth="12"
          markerHeight="12"
          refX="9"
          refY="6"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <circle
            cx="6"
            cy="6"
            r="3.5"
            fill={GRADIENT_TO}
            stroke={GRADIENT_FROM}
            strokeWidth="1"
          />
        </marker>
      </defs>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={`url(#${markerId})`}
        style={{
          ...style,
          stroke: `url(#${gradId})`,
          strokeWidth: 2.5,
          filter: EDGE_GLOW,
        }}
      />
    </>
  );
}

export const GradientEdge = memo(GradientEdgeInner);
