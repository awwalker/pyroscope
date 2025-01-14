/* eslint-disable react/no-unused-state */
/* eslint-disable no-bitwise */
/* eslint-disable react/no-access-state-in-setstate */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable react/destructuring-assignment */
/* eslint-disable no-nested-ternary */

import React from 'react';
import clsx from 'clsx';
import Graph from './FlameGraphComponent';
import TimelineChartWrapper from '../TimelineChartWrapper';
import ProfilerTable from '../ProfilerTable';
import ProfilerHeader from '../ProfilerHeader';
import {
  deltaDiffWrapper,
  parseFlamebearerFormat,
} from '../../util/flamebearer';
import ExportData from '../ExportData';
import { isAbortError } from '../../util/abort';

import InstructionText from './InstructionText';

const paramsToObject = (entries) => {
  const result = {};
  entries.forEach(([key, value]) => {
    result[key] = value;
  });
  return result;
};

const getParamsFromRenderURL = (inputURL) => {
  const urlParamsRegexp = /(.*render\?)(?<urlParams>(.*))/;
  const paramsString = inputURL.match(urlParamsRegexp);

  const params = new URLSearchParams(paramsString.groups.urlParams);
  const paramsObj = paramsToObject([...params.entries()]);
  return paramsObj;
};

class FlameGraphRenderer extends React.Component {
  constructor(props) {
    super();
    this.state = {
      resetStyle: { visibility: 'hidden' },
      sortBy: 'self',
      sortByDirection: 'desc',
      view: 'both',
      viewDiff: props.viewType === 'diff' ? 'diff' : undefined,
      fitMode: props.fitMode ? props.fitMode : 'HEAD',
      flamebearer: null,

      // query used in the 'search' checkbox
      highlightQuery: '',
    };

    // generally not a good idea
    // but we need to access the graph's reset function
    this.graphRef = React.createRef();
  }

  componentDidMount() {
    if (this.props.viewSide === 'left' || this.props.viewSide === 'right') {
      this.fetchFlameBearerData(this.props[`${this.props.viewSide}RenderURL`]);
    } else if (this.props.viewType === 'single') {
      this.fetchFlameBearerData(this.props.renderURL);
    } else if (this.props.viewType === 'diff') {
      this.fetchFlameBearerData(this.props.diffRenderURL);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    const propsChanged =
      getParamsFromRenderURL(this.props.renderURL).query !==
        getParamsFromRenderURL(prevProps.renderURL).query ||
      prevProps.maxNodes !== this.props.maxNodes ||
      prevProps.refreshToken !== this.props.refreshToken;

    if (
      propsChanged ||
      prevProps.from !== this.props.from ||
      prevProps.until !== this.props.until ||
      prevProps[`${this.props.viewSide}From`] !==
        this.props[`${this.props.viewSide}From`] ||
      prevProps[`${this.props.viewSide}Until`] !==
        this.props[`${this.props.viewSide}Until`]
    ) {
      if (this.props.viewSide === 'left' || this.props.viewSide === 'right') {
        this.fetchFlameBearerData(
          this.props[`${this.props.viewSide}RenderURL`]
        );
      } else if (this.props.viewType === 'single') {
        this.fetchFlameBearerData(this.props.renderURL);
      }
    }

    if (this.props.viewType === 'diff') {
      if (
        propsChanged ||
        prevProps.leftFrom !== this.props.leftFrom ||
        prevProps.leftUntil !== this.props.leftUntil ||
        prevProps.rightFrom !== this.props.rightFrom ||
        prevProps.rightUntil !== this.props.rightUntil
      ) {
        this.fetchFlameBearerData(this.props.diffRenderURL);
      }
    }
  }

  componentWillUnmount() {
    this.abortCurrentJSONController();
  }

  updateFitMode = (newFitMode) => {
    this.setState({
      fitMode: newFitMode,
    });
  };

  updateResetStyle = () => {
    // const emptyQuery = this.query === "";
    const topLevelSelected = this.selectedLevel === 0;
    this.setState({
      resetStyle: { visibility: topLevelSelected ? 'hidden' : 'visible' },
    });
  };

  handleSearchChange = (e) => {
    this.setState({
      highlightQuery: e,
    });
    //    this.updateResetStyle();
  };

  reset = () => {
    this.graphRef.current.reset();
  };

  updateView = (newView) => {
    this.setState({
      view: newView,
    });
  };

  updateViewDiff = (newView) => {
    this.setState({
      viewDiff: newView,
    });
  };

  updateSortBy = (newSortBy) => {
    let dir = this.state.sortByDirection;
    if (this.state.sortBy === newSortBy) {
      dir = dir === 'asc' ? 'desc' : 'asc';
    } else {
      dir = 'desc';
    }
    this.setState({
      sortBy: newSortBy,
      sortByDirection: dir,
    });
  };

  onZoom = (selectedLevel) => {
    const topLevelSelected = selectedLevel === 0;
    this.setState({
      resetStyle: { visibility: topLevelSelected ? 'hidden' : 'visible' },
    });
  };

  parseFormat(format) {
    return parseFlamebearerFormat(format || this.state.format);
  }

  abortCurrentJSONController() {
    if (this.currentJSONController) {
      this.currentJSONController.abort();
    }
  }

  fetchFlameBearerData(url) {
    this.abortCurrentJSONController();
    if (this.currentJSONController) {
      this.currentJSONController.abort();
    }
    this.currentJSONController = new AbortController();

    fetch(`${url}&format=json`, { signal: this.currentJSONController.signal })
      .then((response) => response.json())
      .then((data) => {
        const { flamebearer, leftTicks, rightTicks } = data;
        deltaDiffWrapper(flamebearer.format, flamebearer.levels);

        // conceptually makes sense grouping them at frontend level
        // since these ticks are used to compute stuff (eg colors)
        flamebearer.leftTicks = leftTicks;
        flamebearer.rightTicks = rightTicks;

        this.setState({
          flamebearer,
        });
      })
      .catch((e) => {
        // AbortErrors are fine
        if (!isAbortError(e)) {
          throw e;
        }
      })
      .finally();
  }

  render = () => {
    // This is necessary because the order switches depending on single vs comparison view
    const tablePane = (
      <div
        key="table-pane"
        className={clsx('pane', {
          hidden:
            this.state.view === 'icicle' ||
            !this.state.flamebearer ||
            this.state.flamebearer.names.length <= 1,
          'vertical-orientation': this.props.viewType === 'double',
        })}
      >
        <ProfilerTable
          data-testid="table-view"
          flamebearer={this.state.flamebearer}
          sortByDirection={this.state.sortByDirection}
          sortBy={this.state.sortBy}
          updateSortBy={this.updateSortBy}
          view={this.state.view}
          viewDiff={this.state.viewDiff}
          fitMode={this.state.fitMode}
        />
      </div>
    );
    const dataExists =
      this.state.view !== 'table' ||
      (this.state.flamebearer && this.state.flamebearer.names.length <= 1);

    const flameGraphPane =
      this.state.flamebearer && dataExists ? (
        <Graph
          key="flamegraph-pane"
          ref={this.graphRef}
          flamebearer={this.state.flamebearer}
          format={this.parseFormat(this.state.flamebearer.format)}
          view={this.state.view}
          ExportData={ExportData}
          query={this.state.highlightQuery}
          fitMode={this.state.fitMode}
          viewType={this.props.viewType}
          onZoom={this.onZoom}
          label={this.props.query}
        />
      ) : null;

    const panes =
      this.props.viewType === 'double'
        ? [flameGraphPane, tablePane]
        : [tablePane, flameGraphPane];

    // const flotData = this.props.timeline
    //   ? [this.props.timeline.map((x) => [x[0], x[1] === 0 ? null : x[1] - 1])]
    //   : [];

    return (
      <div
        className={clsx('canvas-renderer', {
          double: this.props.viewType === 'double',
        })}
      >
        <div className="canvas-container">
          <ProfilerHeader
            view={this.state.view}
            viewDiff={this.state.viewDiff}
            handleSearchChange={this.handleSearchChange}
            reset={this.reset}
            updateView={this.updateView}
            updateViewDiff={this.updateViewDiff}
            resetStyle={this.state.resetStyle}
            updateFitMode={this.updateFitMode}
            fitMode={this.state.fitMode}
          />
          {this.props.viewType === 'double' ? (
            <>
              <InstructionText {...this.props} />
              <TimelineChartWrapper
                key={`timeline-chart-${this.props.viewSide}`}
                id={`timeline-chart-${this.props.viewSide}`}
                viewSide={this.props.viewSide}
              />
            </>
          ) : this.props.viewType === 'diff' ? (
            <>
              <div className="diff-instructions-wrapper">
                <div className="diff-instructions-wrapper-side">
                  <InstructionText {...this.props} viewSide="left" />
                  <TimelineChartWrapper
                    key="timeline-chart-left"
                    id="timeline-chart-left"
                    viewSide="left"
                  />
                </div>
                <div className="diff-instructions-wrapper-side">
                  <InstructionText {...this.props} viewSide="right" />
                  <TimelineChartWrapper
                    key="timeline-chart-right"
                    id="timeline-chart-right"
                    viewSide="right"
                  />
                </div>
              </div>
            </>
          ) : null}
          <div
            className={clsx('flamegraph-container panes-wrapper', {
              'vertical-orientation': this.props.viewType === 'double',
            })}
          >
            {panes.map((pane) => pane)}
            {/* { tablePane }
            { flameGraphPane } */}
          </div>
        </div>
      </div>
    );
  };
}

export default FlameGraphRenderer;
