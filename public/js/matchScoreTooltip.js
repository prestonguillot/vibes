/**
 * Handle match score tooltip positioning in modals
 * Positions tooltips to prevent overflow and stay visible
 */
document.addEventListener('DOMContentLoaded', () => {
  const tooltips = document.querySelectorAll('.match-score-badge--modal .match-score-tooltip');

  tooltips.forEach((tooltip) => {
    const badge = tooltip.closest('.match-score-badge--modal');

    if (badge) {
      // Position tooltip on hover
      badge.addEventListener('mouseenter', () => {
        positionTooltip(tooltip, badge);
      });

      badge.addEventListener('mousemove', () => {
        positionTooltip(tooltip, badge);
      });
    }
  });

  function positionTooltip(tooltip, badge) {
    // Get the viewport dimensions
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Get badge position relative to viewport
    const badgeRect = badge.getBoundingClientRect();

    // Get modal and modal header for reference
    const modal = badge.closest('.modal');
    const modalHeader = modal?.querySelector('.modal-header');
    const modalHeaderRect = modalHeader ? modalHeader.getBoundingClientRect() : null;
    const modalHeaderHeight = modalHeaderRect ? modalHeaderRect.height : 0;
    const modalHeaderBottom = modalHeaderRect ? modalHeaderRect.bottom : 0;

    // Temporarily show tooltip to measure its dimensions
    tooltip.style.position = 'fixed';
    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';
    const tooltipRect = tooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;

    // Position to the LEFT of the badge with enough gap to show right border and rounded corners
    const gapBetweenBadgeAndTooltip = 16;
    const minimumLeftMargin = 10;
    let left = badgeRect.left - tooltipWidth - gapBetweenBadgeAndTooltip;

    // Ensure tooltip doesn't go off the left edge
    left = Math.max(minimumLeftMargin, left);

    // Ensure tooltip doesn't go off the right edge
    if (left + tooltipWidth > viewportWidth - 10) {
      left = viewportWidth - tooltipWidth - 10;
    }

    // Determine vertical position: try above badge first, fallback to below
    const gapBetweenBadgeAndTooltipVertical = 12;
    const topAboveBadge = badgeRect.top - tooltipHeight - gapBetweenBadgeAndTooltipVertical;
    const topBelowBadge = badgeRect.bottom + gapBetweenBadgeAndTooltipVertical;

    let finalTop;
    // Check if tooltip fits above badge AND below modal header
    if (topAboveBadge > modalHeaderBottom + 10) {
      finalTop = topAboveBadge;
    } else {
      finalTop = topBelowBadge;
    }

    // Ensure tooltip doesn't go off the bottom of the viewport
    if (finalTop + tooltipHeight > viewportHeight - 10) {
      finalTop = Math.max(modalHeaderBottom + 10, viewportHeight - tooltipHeight - 10);
    }

    // Apply final positioning
    tooltip.style.left = left + 'px';
    tooltip.style.top = finalTop + 'px';
    tooltip.style.bottom = 'auto';
    tooltip.style.visibility = 'visible';
  }
});
